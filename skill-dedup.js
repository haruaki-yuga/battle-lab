import { pruneOrphanOfficialSkillIds } from './model.js?v=1.18.21&dialogueui=1';
/**
 * Combat-equivalent active skills share a global skill ID even when the public
 * character page uses a specialized display name. Names are unit-scoped, not
 * identifiers. Keep all modeled combat modifiers in the signature to avoid
 * conflating skills that merely look similar.
 */
const GAMEPLAY_FIELDS = [
    'kind',
    'ap',
    'cost',
    'range',
    'scope',
    'customRange',
    'radius',
    'mainPct',
    'mainBonus',
    'subPct',
    'subBonus',
    'hitBonus',
    'power',
    'bs',
    'bsTurns',
    'buffTurns',
    'modifiers',
    'effects',
    'castMods',
    'grantedEffects',
    'selfModifiers',
    'selfEffects',
    'elements',
    'elementCorrection',
    'trigger',
    'passiveWhen',
    'interval'
];
const normalizeName = name => String(name || '').normalize('NFKC').replace(/\s+/g, '').trim();
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
export function skillGameplayKey(skill) {
    if (!skill || !normalizeName(skill.name))
        return null;
    const data = {};
    for (const key of GAMEPLAY_FIELDS)
        if (skill[key] !== undefined)
            data[key] = skill[key];
    return JSON.stringify(canonical(data));
}
export function sameGameplaySkill(a, b) {
    const key = skillGameplayKey(a);
    return key !== null && key === skillGameplayKey(b);
}
export const isWikiSkill = skill => /^wiki-\d{3}$/.test(skill?.id || '');
export const isCharacterImportedSkill = skill => skill?.source === '公開キャラクターページ' || !!skill?.importedFromCharacter;
/** Character-specific presentation only; combat properties remain in the shared skill. */
export const specializedSkillDetails = (unit, skill) => unit?.specializedSkills?.[skill?.id] || null;
export const displayedSkillName = (unit, skill) => specializedSkillDetails(unit, skill)?.name || unit?.skillAliases?.[skill?.id] || skill?.name || '';
export function displayedSkillText(unit, skill) {
    const details = specializedSkillDetails(unit, skill);
    return {
        name: displayedSkillName(unit, skill),
        baseName: details?.baseName || skill?.baseName || skill?.name || '',
        note: details?.note ?? skill?.note ?? '',
        original: details?.original ?? skill?.original ?? ''
    };
}
/** Upgrade legacy per-character names without changing global IDs or mechanics. */
export function migrateSpecializedSkillMetadata(config) {
    if (!Array.isArray(config?.units) || !Array.isArray(config?.skills)) return config;
    const skills = new Map(config.skills.map(skill => [skill.id, skill]));
    for (const unit of config.units) {
        const metadata = { ...(unit.specializedSkills || {}) };
        for (const [id, name] of Object.entries(unit.skillAliases || {})) {
            const skill = skills.get(id);
            if (skill && name && name !== skill.name && !metadata[id]) {
                // Older saves retained only the alias. Unknown original prose is not invented.
                metadata[id] = { name, baseName: skill.baseName || skill.name };
            }
        }
        for (const skill of config.skills) {
            if (!unit.skills?.includes(skill.id) || metadata[skill.id] ||
                !skill.baseName || skill.baseName === skill.name ||
                skill.importedFromCharacter?.characterId !== unit.importedProfile?.characterId ||
                !unit.importedProfile?.characterId) continue;
            metadata[skill.id] = {
                name: skill.name, baseName: skill.baseName,
                note: skill.note || '', original: skill.original || ''
            };
        }
        unit.specializedSkills = metadata;
    }
    return config;
}
/** Prefer a documented base skill, then matching public name, then WIKI ID. */
export function findReusableImportedSkill(existingSkills, incoming) {
    if (incoming?.requiresReview)
        return null;
    const candidates = existingSkills.filter(s => !s.requiresReview && (isWikiSkill(s) || isCharacterImportedSkill(s)) && sameGameplaySkill(s, incoming));
    candidates.sort((a, b) => {
        const rank = s => Number(normalizeName(s.name) === normalizeName(incoming.baseName)) * 8 +
            Number(normalizeName(s.name) === normalizeName(incoming.name)) * 4 +
            Number(isWikiSkill(s)) * 2;
        return rank(b) - rank(a) || String(a.id).localeCompare(String(b.id));
    });
    return candidates[0] || null;
}
/**
 * Remove old character-page duplicates, keep aliases per unit, and turn
 * unmatched older imports into editable Accel Kaleido skills. User-made
 * custom skills never participate in automatic cleanup.
 */
export function deduplicateImportedSkills(config) {
    if (!config || !Array.isArray(config.skills) || !Array.isArray(config.units))
        return { config, removed: 0, converted: 0 };
    const replacements = new Map(), kept = [];
    const importedById = new Map(config.skills.map(skill => [skill.id, skill]));
    const originals = config.skills.filter(s => !isCharacterImportedSkill(s));
    const imports = config.skills.filter(isCharacterImportedSkill);
    let converted = 0;
    for (const skill of imports) {
        const existing = skill.requiresReview ? null : findReusableImportedSkill([...originals, ...kept], skill);
        // Do not collapse two differently named skills already owned by one unit.
        // One unit cannot hold two distinct names on the same skill ID.
        const sharedSlotConflict = existing && config.units.some(unit =>
            unit.skills?.includes(existing.id) && unit.skills.includes(skill.id) &&
            (unit.skillAliases?.[existing.id] || existing.name) !==
            (unit.skillAliases?.[skill.id] || skill.name));
        if (existing && existing.id !== skill.id && !sharedSlotConflict)
            replacements.set(skill.id, { id: existing.id, name: skill.name, canonicalName: existing.name });
        else {
            if (skill.source === '公開キャラクターページ') {
                delete skill.source;
                skill.importedFromCharacter ??= { originalId: skill.originSkillId || null };
                converted++;
            }
            kept.push(skill);
        }
    }
    if (replacements.size) {
        config.skills = config.skills.filter(s => !replacements.has(s.id));
        for (const unit of config.units) {
            const aliases = { ...(unit.skillAliases || {}) };
            const specialized = { ...(unit.specializedSkills || {}) };
            const officialSkillIds = { ...(unit.officialSkillIds || {}) };
            for (const oldId of unit.skills || []) {
                const replacement = replacements.get(oldId);
                if (!replacement)
                    continue;
                const alias = aliases[oldId] || replacement.name;
                if (alias && alias !== replacement.canonicalName)
                    aliases[replacement.id] = alias;
                const original = importedById.get(oldId);
                if (alias && (alias !== replacement.canonicalName || original?.baseName !== original?.name)) {
                    specialized[replacement.id] = specialized[oldId] || {
                        name: alias,
                        baseName: original?.baseName || replacement.canonicalName,
                        note: original?.note || '', original: original?.original || ''
                    };
                }
                // A reused WIKI/canonical skill must keep this character's original
                // official ID. Otherwise a subsequent validation sees a dangling key.
                if (Object.hasOwn(officialSkillIds, oldId)) {
                    if (!Object.hasOwn(officialSkillIds, replacement.id))
                        officialSkillIds[replacement.id] = officialSkillIds[oldId];
                    delete officialSkillIds[oldId];
                }
                delete specialized[oldId];
                delete aliases[oldId];
            }
            // Unequipped imported skills can also carry historic source IDs.
            // Their legacy IDs must follow the canonicalized definition.
            for (const [oldId, replacement] of replacements) {
                if (Object.hasOwn(officialSkillIds, oldId)) {
                    if (!Object.hasOwn(officialSkillIds, replacement.id))
                        officialSkillIds[replacement.id] = officialSkillIds[oldId];
                    delete officialSkillIds[oldId];
                }
                if (Object.hasOwn(aliases, oldId)) {
                    if (!Object.hasOwn(aliases, replacement.id))
                        aliases[replacement.id] = aliases[oldId];
                    delete aliases[oldId];
                }
                if (Object.hasOwn(specialized, oldId)) {
                    if (!Object.hasOwn(specialized, replacement.id))
                        specialized[replacement.id] = specialized[oldId];
                    delete specialized[oldId];
                }
            }
            if (Array.isArray(unit.skills))
                unit.skills = [...new Set(unit.skills.map(id => replacements.get(id)?.id || id))];
            for (const rule of unit.rules || [])
                if (rule?.action === 'skill' && replacements.has(rule.skillId))
                    rule.skillId = replacements.get(rule.skillId).id;
            unit.skillAliases = aliases;
            unit.specializedSkills = specialized;
            unit.officialSkillIds = officialSkillIds;
        }
    }
    // Repair legacy saved mappings that refer to already-deleted definitions.
    // Do not drop IDs solely because their skill is currently unequipped.
    pruneOrphanOfficialSkillIds(config);
    migrateSpecializedSkillMetadata(config);
    return { config, removed: replacements.size, converted };
}
