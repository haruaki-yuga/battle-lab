/** Translate the retired maximum-HP/AP *grant* into the shared HP/AP barrier.
 * Base unit maxHp/maxAp are permanent statistics and are never converted.
 * Repeated imports are safe: the legacy keys are removed after conversion.
 */
export function updateLegacyBarrierText(text) {
    return String(text || '').replace(/(【(?:自|付)：)最大(?:HP|AP)\+?(\d+)(】)/g,
        (_, open, amount, close) => `${open}障壁${Number(amount) * 2}${close}`);
}
export function normalizeLegacyBarrierSkill(skill) {
    if (!skill || typeof skill !== 'object') return skill;
    for (const [modsKey, effectKey] of [['modifiers', 'grantedEffects'], ['selfModifiers', 'selfEffects']]) {
        const mods = skill[modsKey];
        if (!mods || typeof mods !== 'object') continue;
        const legacy = [mods.maxHp, mods.maxAp].filter(v => Number.isFinite(Number(v)) && Number(v) > 0);
        if (legacy.length) {
            skill[effectKey] ??= {};
            // Grants of the same type do not stack: keep the strongest value.
            skill[effectKey].barrier = Math.max(Number(skill[effectKey].barrier) || 0, ...legacy.map(v => 2 * Number(v)));
        }
        delete mods.maxHp;
        delete mods.maxAp;
    }
    if (skill.original) skill.original = updateLegacyBarrierText(skill.original);
    return skill;
}
export function normalizeLegacyBarrierConfig(config) {
    for (const skill of config?.skills || []) normalizeLegacyBarrierSkill(skill);
    // Older imports sometimes store buff-like effects directly on a unit.
    for (const unit of config?.units || []) {
        const eff = unit.effects || {};
        const legacy = [eff.maxHp, eff.maxAp].filter(v => Number.isFinite(Number(v)) && Number(v) > 0);
        if (legacy.length) eff.barrier = Math.max(Number(eff.barrier) || 0, ...legacy.map(v => 2 * Number(v)));
        delete eff.maxHp;
        delete eff.maxAp;
    }
    return config;
}
