import { REACTION_DEFINITIONS, normalizedReactionLines } from './battle-reactions.js?v=1.18.21&dialogueui=1';

export const REACTION_JSON_FORMAT = 'rosuaka-reaction-lines';
export const REACTION_JSON_VERSION = 1;
const allowed = new Set(REACTION_DEFINITIONS.map(def => def.key));

// Portable, dialogue-only file. Never includes rules, skill definitions, or statistics.
export function exportReactionJson(unit) {
    if (!unit || typeof unit !== 'object') throw Error('書き出すキャラクターが不正です。');
    return {
        format: REACTION_JSON_FORMAT,
        version: REACTION_JSON_VERSION,
        sourceUnit: String(unit.name || ''),
        reactionLines: normalizedReactionLines(unit.reactionLines)
    };
}

export function readReactionJson(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        payload.format !== REACTION_JSON_FORMAT || payload.version !== REACTION_JSON_VERSION ||
        !payload.reactionLines || typeof payload.reactionLines !== 'object' || Array.isArray(payload.reactionLines))
        throw Error('セリフ専用JSONではありません。演出タブから書き出したJSONを指定してください。');
    if (Object.entries(payload.reactionLines).some(([key, value]) => !allowed.has(key) || typeof value !== 'string'))
        throw Error('セリフの条件または文字列が不正です。');
    const adjusted = Object.values(payload.reactionLines).some(value => value.length > 80);
    return { lines: normalizedReactionLines(payload.reactionLines), sourceUnit: typeof payload.sourceUnit === 'string' ? payload.sourceUnit : '', adjusted };
}
