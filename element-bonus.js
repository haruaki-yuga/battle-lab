// Arena-only elemental HP attack modifiers. Never recalculate imported stats.
// Official ELEMENT IDs remain canonical even when an attribute is specialized.
export const ELEMENT_KEYS = Object.freeze(['火', '水', '土', '風', '光', '闇', '無']);
export const ELEMENT_ID_TO_KEY = Object.freeze({ 101: '火', 102: '水', 103: '土', 104: '風', 105: '光', 106: '闇', 199: '無' });
const THRESHOLDS = [1, 5, 10, 15, 20, 25];
const FOUR_ADVANTAGE = Object.freeze({ 火: '風', 水: '火', 土: '水', 風: '土' });
export const emptyElement = () => ({ key: null, value: 0 });
export const elementLevel = value => THRESHOLDS.reduce((lv, min) => Number(value) >= min ? lv + 1 : lv, 0);
export const validElement = e => !!e && typeof e === 'object' && !Array.isArray(e) &&
    (e.key === null || ELEMENT_KEYS.includes(e.key)) && Number.isSafeInteger(e.value) &&
    e.value >= 0 && e.value <= 1e6 && (e.key !== null || e.value === 0);

// Legacy v1.17.3 data used a seven-value object. Use only the greatest value;
// equal positive values use canonical key order for deterministic migration.
export const emptyElements = () => Object.fromEntries(ELEMENT_KEYS.map(k => [k, 0]));
export function validElements(elements) {
    return !!elements && typeof elements === 'object' && !Array.isArray(elements) &&
        ELEMENT_KEYS.every(k => Number.isSafeInteger(elements[k]) && elements[k] >= 0 && elements[k] <= 1e6) &&
        Object.keys(elements).every(k => ELEMENT_KEYS.includes(k));
}
export function highestElement(elements) {
    if (!validElements(elements)) return null;
    const max = Math.max(...ELEMENT_KEYS.map(k => elements[k]));
    return max === 0 ? emptyElement() : { key: ELEMENT_KEYS.find(k => elements[k] === max), value: max };
}
export function migrateUnitElement(unit) {
    if (unit.element === undefined) {
        unit.element = highestElement(unit.elements) || emptyElement();
    }
    delete unit.elements;
    return unit;
}

// Preserve strict GraphQL validation: missing/duplicate ELEMENT IDs are not zero.
export function extractCharacterElements(subStatus) {
    if (!Array.isArray(subStatus)) return null;
    const values = emptyElements(), found = new Set();
    for (const row of subStatus) {
        if (row?.type !== 'ELEMENT') continue;
        const key = ELEMENT_ID_TO_KEY[row.id];
        if (!key) continue;
        if (found.has(key) || !Number.isSafeInteger(row.value) || row.value < 0 || row.value > 1e6) return null;
        found.add(key);
        values[key] = row.value;
    }
    return found.size === ELEMENT_KEYS.length ? values : null;
}
export function extractMainCharacterElement(subStatus) {
    const all = extractCharacterElements(subStatus);
    return all ? highestElement(all) : null;
}

// Only the one equipped attribute on each side is relevant. The accepted
// inferred wiki progressions are applied to HP damage from direct attacks only.
export function elementDamageBonus(attacker, defender) {
    const a = attacker?.element ?? highestElement(attacker?.elements);
    const d = defender?.element ?? highestElement(defender?.elements);
    const atk = validElement(a) && a.value > 0 ? a.key : null;
    const def = validElement(d) && d.value > 0 ? d.key : null;
    const aLevel = atk ? elementLevel(a.value) : 0;
    const dLevel = def ? elementLevel(d.value) : 0;
    let attackPercent = 0, reductionPercent = 0;
    if (atk && def) {
        if (FOUR_ADVANTAGE[atk] === def) attackPercent = aLevel * 5;
        if (FOUR_ADVANTAGE[def] === atk) reductionPercent = dLevel * 2;
        if (['火', '水', '土', '風'].includes(def) && atk === '無' && dLevel >= 4)
            reductionPercent = dLevel * 2;
        if ((atk === '光' && def === '闇') || (atk === '闇' && def === '光'))
            attackPercent = aLevel * 7;
        if ((atk === '光' || atk === '闇') && def === '無') attackPercent = aLevel * 3;
        if (atk === '無' && (def === '光' || def === '闇')) attackPercent = aLevel * 2;
        if (def === '無' && atk !== '無') reductionPercent = dLevel * 2;
    }
    reductionPercent = Math.min(95, reductionPercent);
    return { attackPercent, reductionPercent, factor: (1 + attackPercent / 100) * (1 - reductionPercent / 100) };
}
