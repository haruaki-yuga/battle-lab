import {validReactionLines,normalizedReactionLines} from './battle-reactions.js?v=1.18.21';
import { CATALOG } from './catalog.js';
import { normalizeLegacyBarrierSkill } from './barrier-rules.js';
import { clone, uid, validateConfig } from './model.js?v=1.18.21';
export const UNIT_TACTICS_FORMAT = 'rosuaka-unit-tactics';
export const UNIT_TACTICS_VERSION = 1;
const WIKI_IDS = new Set(CATALOG.map(s => s.id));
function isStringId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 200;
}
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
}
function sameSkill(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
/** Export only the selected unit's equipped skills, ordered AI, and required custom definitions. */
export function exportUnitTactics(config, unitId) {
    const unit = config.units.find(u => u.id === unitId);
    if (!unit)
        throw Error('書き出し対象のキャラクターが見つかりません。');
    const ids = [...new Set([...unit.skills, ...Object.keys(unit.specializedSkills || {})])];
    const definitions = [];
    for (const id of ids) {
        const s = config.skills.find(item => item.id === id);
        if (!s)
            throw Error(`装備スキル「${id}」が見つかりません。`);
        if (!WIKI_IDS.has(id))
            definitions.push(clone(s));
    }
    return {
        format: UNIT_TACTICS_FORMAT,
        version: UNIT_TACTICS_VERSION,
        sourceUnit: { id: unit.id, name: unit.name },
        skills: clone(unit.skills),
        rules: clone(unit.rules),
        reactionLines: clone(normalizedReactionLines(unit.reactionLines)),
        customSkills: definitions,
        skillAliases: clone(unit.skillAliases || {}),
        specializedSkills: clone(unit.specializedSkills || {}),
        officialSkillIds: Object.fromEntries(Object.entries(unit.officialSkillIds || {})
            .filter(([id]) => unit.skills.includes(id)))
    };
}
/** Import without touching stats, team, position, or any other unit's equipment/AI. */
export function importUnitTactics(config, targetId, data) {
    if (!data || data.format !== UNIT_TACTICS_FORMAT || data.version !== UNIT_TACTICS_VERSION)
        throw Error('キャラクター別スキル・AI設定JSONではありません。');
    if (!data.sourceUnit || !isStringId(data.sourceUnit.id) ||
        !Array.isArray(data.skills) || !Array.isArray(data.rules) || !Array.isArray(data.customSkills))
        throw Error('ファイル内の装備スキル・AIルール・スキル定義が不正です。');
    if (data.skills.length > 200 || data.rules.length > 200 || data.customSkills.length > 200)
        throw Error('スキルまたはAIルールの件数が多すぎます。');
    if (data.skills.some(id => !isStringId(id)) || new Set(data.skills).size !== data.skills.length)
        throw Error('装備スキルIDが不正、または重複しています。');
    if (data.skillAliases !== undefined && (!data.skillAliases || typeof data.skillAliases !== 'object' || Array.isArray(data.skillAliases) || Object.entries(data.skillAliases).some(([id, name]) => !data.skills.includes(id) || typeof name !== 'string' || !name.trim() || name.length > 200)))
        throw Error('スキルの個別名称データが不正です。');
    if (data.specializedSkills !== undefined && (!data.specializedSkills ||
        typeof data.specializedSkills !== 'object' || Array.isArray(data.specializedSkills) ||
        Object.entries(data.specializedSkills).some(([id, detail]) => !isStringId(id) ||
            !detail || typeof detail !== 'object' || Array.isArray(detail) ||
            typeof detail.name !== 'string' || !detail.name.trim() || detail.name.length > 200 ||
            ['baseName', 'note', 'original'].some(k => detail[k] !== undefined &&
                (typeof detail[k] !== 'string' || detail[k].length > 20000)))))
        throw Error('キャラクター別の特殊化スキル情報が不正です。');
    if (data.officialSkillIds !== undefined && (!data.officialSkillIds ||
        typeof data.officialSkillIds !== 'object' || Array.isArray(data.officialSkillIds) ||
        Object.entries(data.officialSkillIds).some(([id, originalId]) =>
            !isStringId(id) || typeof originalId !== 'string' || !originalId || originalId.length > 200)))
        throw Error('公式スキルIDの対応情報が不正です。');
    if (!validReactionLines(data.reactionLines))
        throw Error('演出セリフの設定が不正です。');
    if (data.rules.some(r => !r || typeof r !== 'object' || Array.isArray(r)))
        throw Error('キャラAIルールの形式が不正です。');
    const target = config.units.find(u => u.id === targetId);
    if (!target)
        throw Error('読込先のキャラクターが見つかりません。');
    const result = clone(config), dst = result.units.find(u => u.id === targetId);
    const owned = new Set([...data.skills, ...Object.keys(data.specializedSkills || {})]);
    const idMap = new Map(), usedIds = new Set(result.skills.map(s => s.id));
    const customIds = new Set();
    let added = 0;
    for (const definition of data.customSkills) {
        if (!definition || typeof definition !== 'object' || Array.isArray(definition) || !isStringId(definition.id) || WIKI_IDS.has(definition.id) || (definition.source && definition.source !== '公開キャラクターページ'))
            throw Error('自作スキル定義が不正、またはWIKIスキルを上書きしようとしています。');
        if (!owned.has(definition.id) || customIds.has(definition.id))
            throw Error('自作スキルの参照またはIDが重複しています。');
        customIds.add(definition.id);
        const original = normalizeLegacyBarrierSkill(clone(definition));
        if (original.source === '公開キャラクターページ') {
            delete original.source;
            original.importedFromCharacter ??= { originalId: original.originSkillId || null };
        }
        const existing = result.skills.find(s => s.id === original.id);
        if (!existing) {
            result.skills.push(original);
            usedIds.add(original.id);
            added++;
        }
        else if (!sameSkill(existing, original)) {
            let newId;
            do {
                newId = uid('acc');
            } while (usedIds.has(newId) || WIKI_IDS.has(newId));
            usedIds.add(newId);
            original.id = newId;
            result.skills.push(original);
            idMap.set(definition.id, newId);
            added++;
        }
    }
    for (const id of owned) {
        if (!WIKI_IDS.has(id) && !customIds.has(id))
            throw Error(`自作スキル「${id}」の定義がファイルにありません。`);
        if (!result.skills.some(s => s.id === (idMap.get(id) || id)))
            throw Error(`スキル「${id}」が読込先にありません。`);
    }
    dst.skills = data.skills.map(id => idMap.get(id) || id);
    dst.skillAliases = Object.fromEntries(Object.entries(data.skillAliases || {}).map(([id, name]) => [idMap.get(id) || id, name]));
    dst.specializedSkills = Object.fromEntries(Object.entries(data.specializedSkills || {}).map(([id, detail]) => [idMap.get(id) || id, clone(detail)]));
    // Older exports could include mappings for unequipped or since-deleted
    // skills. Retain known source IDs, but never introduce dangling IDs.
    const availableSkillIds = new Set(result.skills.map(s => s.id));
    const mappedOfficialIds = Object.entries(data.officialSkillIds || {})
        .map(([id, original]) => [idMap.get(id) || id, original]);
    const ignoredOfficialIds = mappedOfficialIds.filter(([id]) => !availableSkillIds.has(id));
    dst.officialSkillIds = Object.fromEntries(mappedOfficialIds.filter(([id]) => availableSkillIds.has(id)));
    // Old tactic exports only had aliases; preserve those as per-unit records.
    for (const [id, name] of Object.entries(dst.skillAliases)) {
        const s = result.skills.find(s => s.id === id);
        if (s && name !== s.name && !dst.specializedSkills[id])
            dst.specializedSkills[id] = { name, baseName: s.baseName || s.name };
    }
    const warnings = [];
    if (ignoredOfficialIds.length)
        warnings.push(`存在しないスキルの公式ID対応 ${ignoredOfficialIds.length}件を無視しました。`);
    dst.reactionLines = normalizedReactionLines(data.reactionLines);
    dst.rules = clone(data.rules).map(r => {
        r.id = uid('r');
        if (r.action === 'skill' && idMap.has(r.skillId))
            r.skillId = idMap.get(r.skillId);
        // Character ID references to the source self must follow the chosen import slot.
        if (r.target === 'id') {
            if (r.targetUnitId === data.sourceUnit.id) r.targetUnitId = targetId;
            else if (!result.units.some(u => u.id === r.targetUnitId)) {
                r.target = 'self'; r.targetUnitId = '';
                warnings.push('存在しない行動対象IDがあったため「自身」へ変更しました。');
            }
        }
        for (const condition of [...(r.conditions || []), ...(r.moveConditions || [])]) {
            if (condition?.type !== 'who' || condition.subject !== 'id') continue;
            if (condition.characterId === data.sourceUnit.id) condition.characterId = targetId;
            else if (!result.units.some(u => u.id === condition.characterId)) {
                // Do not turn an impossible external character ID into an arbitrary valid target.
                r.enabled = false;
                warnings.push('存在しない発動条件のIDが含まれるルールを無効化しました。');
            }
        }
        if (r.splitMovement && r.moveTargetMode === 'individual' && r.moveSubject === 'id') {
            if (r.moveUnitId === data.sourceUnit.id)
                r.moveUnitId = targetId;
            else if (!result.units.some(u => u.id === r.moveUnitId)) {
                // An AI referencing a unit that is not present in the destination team
                // should still be importable without accidentally moving to a wrong ID.
                r.splitMovement = false;
                r.moveTargetMode = 'same';
                r.moveUnitId = '';
                warnings.push('存在しない移動基準のユニットIDがあったため、そのルールを「行動対象と同じ」に戻しました。');
            }
        }
        return r;
    });
    const failures = validateConfig(result);
    if (failures.length)
        throw Error(`読込後の設定を検証できません：${failures.join(' / ')}`);
    return {
        config: result,
        unitId: targetId,
        skillCount: dst.skills.length,
        ruleCount: dst.rules.length,
        addedCustomSkills: added,
        warnings
    };
}
