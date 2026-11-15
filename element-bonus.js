// Arena-specific elemental damage bonuses. Base stats are NOT recalculated.
// Canonical GraphQL ELEMENT IDs are stable even when the display name is specialized.
export const ELEMENT_KEYS = Object.freeze(['火', '水', '土', '風', '光', '闇', '無']);
export const ELEMENT_ID_TO_KEY = Object.freeze({ 101: '火', 102: '水', 103: '土', 104: '風', 105: '光', 106: '闇', 199: '無' });
const THRESHOLDS = [1, 5, 10, 15, 20, 25];
const FOUR_ADVANTAGE = Object.freeze({ 火: '風', 水: '火', 土: '水', 風: '土' });
export const emptyElements = () => Object.fromEntries(ELEMENT_KEYS.map(k => [k, 0]));
export const elementLevel = value => THRESHOLDS.reduce((lv, min) => Number(value) >= min ? lv + 1 : lv, 0);

export function validElements(elements) {
    return !!elements && typeof elements === 'object' && !Array.isArray(elements) &&
        ELEMENT_KEYS.every(key => Number.isSafeInteger(elements[key]) && elements[key] >= 0 && elements[key] <= 1e6) &&
        Object.keys(elements).every(key => ELEMENT_KEYS.includes(key));
}

// A missing/duplicated canonical ID must not silently be treated as an attribute of 0.
// Imported specialized labels such as 紫電(闇) are resolved by id 106, never by text.
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

// The users agreed to the wiki's regular progressions, including inferred values
// not yet explicitly specified on the wiki for Lv5/Lv6 and Lv1-Lv3 defense.
// Only outgoing HP attack damage receives the multiplier; HP/AP/skill statistics,
// DOT, recoil, upkeep and sudden-death tax are not altered.
export function elementDamageBonus(attacker, defender) {
    const a = attacker?.elements || {}, d = defender?.elements || {};
    const aLevel = Object.fromEntries(ELEMENT_KEYS.map(k => [k, elementLevel(a[k]) ]));
    const dLevel = Object.fromEntries(ELEMENT_KEYS.map(k => [k, elementLevel(d[k]) ]));
    let attackPercent = 0, reductionPercent = 0;
    for (const [key, favored] of Object.entries(FOUR_ADVANTAGE)) {
        if (aLevel[key] && dLevel[favored]) attackPercent += aLevel[key] * 5;
        if (dLevel[key] && aLevel[favored]) reductionPercent += dLevel[key] * 2;
        // Lv4+ shields against neutral-origin attacks for all four elements.
        if (dLevel[key] >= 4 && aLevel['無']) reductionPercent += dLevel[key] * 2;
    }
    for (const [key, opposite] of [['光', '闇'], ['闇', '光']]) {
        if (aLevel[key] && dLevel[opposite]) attackPercent += aLevel[key] * 7;
        if (aLevel[key] && dLevel['無']) attackPercent += aLevel[key] * 3;
    }
    if (aLevel['無'] && (dLevel['光'] || dLevel['闇'])) {
        // Neutral's +2% applies once per level to each relevant elemental target.
        attackPercent += aLevel['無'] * 2 * Number(dLevel['光'] > 0) + aLevel['無'] * 2 * Number(dLevel['闇'] > 0);
    }
    if (dLevel['無']) {
        // Neutral reduces damage from each of the six elemental sources.
        for (const key of ELEMENT_KEYS.filter(k => k !== '無')) {
            if (aLevel[key]) reductionPercent += dLevel['無'] * 2;
        }
    }
    reductionPercent = Math.min(95, reductionPercent);
    const factor = (1 + attackPercent / 100) * (1 - reductionPercent / 100);
    return { attackPercent, reductionPercent, factor };
}
