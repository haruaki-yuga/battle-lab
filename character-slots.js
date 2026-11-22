/** Browser-local character snapshots, independent from active team configuration. */
import { clone, freshUnit, arrangeInitialPositions, validateConfig } from './model.js?v=1.18.21&dialogueui=1';
import { exportUnitCharacter, importUnitCharacter } from './unit-character-io.js?v=1.18.21&dialogueui=1';

export const CHARACTER_SLOT_COUNT = 10;
export const CHARACTER_SLOT_STORAGE_KEY = 'arcadia-battle-lab-character-slots-v1';
const SLOT_VERSION = 1;
const slotNumber = index => {
    if (!Number.isInteger(index) || index < 0 || index >= CHARACTER_SLOT_COUNT)
        throw Error('保存スロット番号が不正です。');
    return index;
};
const isStoredSlot = entry => !!entry && typeof entry === 'object' && !Array.isArray(entry)
    && entry.version === SLOT_VERSION && typeof entry.name === 'string'
    && ['A', 'B'].includes(entry.team) && entry.snapshot?.format === 'rosuaka-unit-character';

export function readCharacterSlots(storage) {
    try {
        const value = JSON.parse(storage?.getItem(CHARACTER_SLOT_STORAGE_KEY) || 'null');
        if (value?.version !== SLOT_VERSION || !Array.isArray(value.slots))
            return Array(CHARACTER_SLOT_COUNT).fill(null);
        return Array.from({length: CHARACTER_SLOT_COUNT}, (_, index) =>
            isStoredSlot(value.slots[index]) ? clone(value.slots[index]) : null);
    } catch {
        return Array(CHARACTER_SLOT_COUNT).fill(null);
    }
}
function commitSlots(storage, slots) {
    if (!storage?.setItem) throw Error('ブラウザ内の保存領域を利用できません。');
    try {
        storage.setItem(CHARACTER_SLOT_STORAGE_KEY, JSON.stringify({version:SLOT_VERSION, slots}));
    } catch {
        throw Error('スロットの保存に失敗しました。ブラウザの保存容量やプライベートモードを確認してください。');
    }
    return slots;
}
export function saveCharacterSlot(storage, index, config, unitId, savedAt = new Date().toISOString()) {
    slotNumber(index);
    const unit = config.units?.find(item => item.id === unitId);
    if (!unit) throw Error('保存対象のキャラクターが見つかりません。');
    // Reuses the complete character JSON export, including custom skill definitions and AI.
    const snapshot = exportUnitCharacter(config, unitId);
    const slots = readCharacterSlots(storage);
    slots[index] = {version: SLOT_VERSION, name: unit.name, team: unit.team, savedAt, snapshot};
    commitSlots(storage, slots);
    return slots[index];
}
export function clearCharacterSlot(storage, index) {
    slotNumber(index);
    const slots = readCharacterSlots(storage);
    slots[index] = null;
    commitSlots(storage, slots);
}
/** Add a new unit from a snapshot, preserving existing units and their AI. */
export function loadCharacterSlot(storage, index, config, team) {
    slotNumber(index);
    if (!['A','B'].includes(team)) throw Error('読込先チームが不正です。');
    const saved = readCharacterSlots(storage)[index];
    if (!saved) throw Error('このスロットは空です。');
    if (!Array.isArray(config?.units) || config.units.length >= 16)
        throw Error('編成は最大16人です。先にユニットを削除してください。');
    const working = clone(config);
    const unit = freshUnit({name:saved.name, team, skills:[], x:team==='A'?-10:10, y:0});
    working.units.push(unit);
    const loaded = importUnitCharacter(working, unit.id, clone(saved.snapshot));
    arrangeInitialPositions(loaded.config.units);
    const errors = validateConfig(loaded.config);
    if (errors.length) throw Error('読込後の編成を検証できません：'+errors.join(' / '));
    return { config: loaded.config, unitId: unit.id, unitName: loaded.name,
        skillCount: loaded.skillCount, ruleCount: loaded.ruleCount,
        addedCustomSkills: loaded.addedCustomSkills, warnings: loaded.warnings };
}
