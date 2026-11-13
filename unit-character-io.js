/** One character per JSON file. Unit identity, team and map position belong to the destination slot. */
import { clone, STAT_LABELS, RANGES, BS_NAMES, validateConfig } from './model.js';
import { exportUnitTactics, importUnitTactics, UNIT_TACTICS_FORMAT } from './unit-tactics-io.js';

export const CHARACTER_FORMAT = 'rosuaka-unit-character';
export const CHARACTER_FORMAT_VERSION = 1;
const numericFields = [...Object.keys(STAT_LABELS), 'startHp', 'startAp'];
const characterFields = ['name', ...numericFields, 'normalRange', 'effects', 'initialBS', 'immunities', 'importedProfile'];
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function exportUnitCharacter(config, unitId) {
    const unit = config.units?.find(item => item.id === unitId);
    if (!unit) throw Error('書き出し対象のキャラクターが見つかりません。');
    const character = {};
    for (const field of characterFields) {
        if (unit[field] !== undefined) character[field] = clone(unit[field]);
    }
    return {
        format: CHARACTER_FORMAT,
        version: CHARACTER_FORMAT_VERSION,
        sourceUnit: { id: unit.id, name: unit.name, team: unit.team },
        character,
        tactics: exportUnitTactics(config, unitId)
    };
}

function validateCharacter(data) {
    if (!isPlainObject(data) || data.format !== CHARACTER_FORMAT || data.version !== CHARACTER_FORMAT_VERSION)
        throw Error('キャラクター1人分のJSONではありません。対象キャラを選んで書き出したファイルを指定してください。');
    if (!isPlainObject(data.character) || !isPlainObject(data.tactics) ||
        data.tactics.format !== UNIT_TACTICS_FORMAT || !isPlainObject(data.sourceUnit) ||
        data.sourceUnit.id !== data.tactics.sourceUnit?.id)
        throw Error('キャラクターデータ、装備スキルまたはAI設定の形式が正しくありません。');
    const char = data.character;
    if (typeof char.name !== 'string' || !char.name.trim() || char.name.length > 50)
        throw Error('キャラクター名が不正です。');
    for (const field of numericFields) {
        if (typeof char[field] !== 'number' || !Number.isFinite(char[field]) || Math.abs(char[field]) > 1e9)
            throw Error(`${field} の能力値が不正です。`);
    }
    if (!(char.normalRange in RANGES)) throw Error('通常攻撃の射程が不正です。');
    if (!isPlainObject(char.effects) || Object.values(char.effects).some(n => typeof n !== 'number' || !Number.isFinite(n)))
        throw Error('固有の特殊効果が不正です。');
    for (const field of ['initialBS', 'immunities']) {
        if (!Array.isArray(char[field]) || char[field].length > 100 || char[field].some(name => !BS_NAMES.includes(name)))
            throw Error(`${field} のBS指定が不正です。`);
    }
    if (char.importedProfile !== undefined && !isPlainObject(char.importedProfile))
        throw Error('キャラクター参照情報の形式が不正です。');
}

/** Replace just the chosen character's data, skills and AI; preserve the selected slot's ID/team/X/Y. */
export function importUnitCharacter(config, targetId, data) {
    validateCharacter(data);
    const target = config.units?.find(item => item.id === targetId);
    if (!target) throw Error('読み込み先のキャラクターが見つかりません。');
    const appliedTactics = importUnitTactics(config, targetId, data.tactics);
    const next = appliedTactics.config;
    const destination = next.units.find(item => item.id === targetId);
    // Clear importedProfile if the file did not contain one, avoiding stale metadata.
    delete destination.importedProfile;
    for (const field of characterFields) {
        if (field in data.character) destination[field] = clone(data.character[field]);
    }
    const errors = validateConfig(next);
    if (errors.length) throw Error('読み込み後の設定が不正です：' + errors.join(' / '));
    return {
        ...appliedTactics,
        config: next,
        name: destination.name,
        destinationTeam: destination.team,
        destinationPosition: { x: destination.x, y: destination.y }
    };
}
