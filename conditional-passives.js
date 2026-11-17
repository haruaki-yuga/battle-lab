/**
 * Official Lost Arcadia conditional passive parameters.
 * The character-profile sub_status values remain the imported base statistics.
 * Official imported sub_status values ALREADY CONTAIN the 渾身 and 時限
 * modifiers.  Subtract one copy of 渾身 below 80% HP and one copy of 時限
 * after X complete turns (from turn X+1).  At the start of battle,
 * subtract neither one: they must NOT be counted twice.
 * Official imported sub_status values DO NOT CONTAIN 底力 or 加速.
 * Add 底力 at or below 30% HP and 加速 each Nth turn (up to 20/N times).
 * Applies equally to numeric stats and supported extra sub_status effects.
 */
export const PASSIVE_KIND_LABELS = Object.freeze({ accel: '加速', full: '渾身', low: '底力', timed: '時限' });

// Extra passive modifiers use the same keys as unit.effects / Battle.effectRaw.
// Stateful effects (e.g. barrier) are deliberately excluded: they cannot be
// accurately represented as a temporary numeric status without extra state.
const effectAliases = Object.freeze({
    再生: 'regen', 充填: 'charge', 能率: 'efficiency', ダメージ: 'dot', ロスト: 'lost',
    摩耗: 'erosion', 'HP吸収': 'hpDrain', 'AP吸収': 'apDrain', 'HA吸収': 'haDrain',
    攻勢BS回復: 'offensiveCleanse', 'BS回復': 'bsHeal', 'HP鎧': 'hpArmor',
    'AP鎧': 'apArmor', 'BS鎧': 'bsArmor', 'BS緩和': 'bsEase',
    追撃: 'pursuit', 邪道: 'evil', 鬼道: 'demon', 復讐: 'revenge',
    巧妙: 'clever', 堅実: 'steady', 多重影: 'multiShadow',
    スプラッシュ: 'splash', 弱点: 'weak', 曲射: 'curve', 重甲: 'heavy',
    高速詠唱: 'fastCast', 'ブレイクガード': 'breakGuard', 光輝: 'radiance'
});
const statAliases = Object.freeze({
    HP: 'maxHp', AP: 'maxAp',
    主攻: 'main', 主攻撃力: 'main', 副攻: 'sub', 副攻撃力: 'sub',
    回復: 'heal', 回復力: 'heal', 命中: 'hit', 回避: 'evade',
    防技: 'defense', 防御技術: 'defense', 抵抗: 'resist', 特殊抵抗: 'resist',
    速度: 'speed', 機動: 'mobility', 機動力: 'mobility',
    CT: 'critical', クリティカル: 'critical', FB: 'fumble', ファンブル: 'fumble', ドラマ: 'drama'
});

/**
 * Official GraphQL display_effects is HTML-marked text, not a plain formula.
 * <x-effect description="...">加速4</x-effect> is a NORMAL response shape.
 * Ignore tag attributes (which may themselves mention effects), preserve only
 * visible text, and decode numeric/basic entities. Never inject this into HTML.
 */
function officialEffectText(value) {
    return String(value ?? '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
        .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|plus);/gi, (_, entity) => {
            if (entity[0] === '#') {
                const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
                return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
            }
            return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',plus:'+'}[entity.toLowerCase()] ?? '';
        })
        .normalize('NFKC')
        .replace(/\s+/g, '');
}

export function parseConditionalPassive(raw, category = 'パッシヴ') {
    // Parse the VISIBLE official formula, never the x-effect markup/attributes.
    // Some official skills write 〖加速+5〗 rather than 〖加速5〗.
    const original = officialEffectText(raw?.display_effects);
    const tags = [...original.matchAll(/[〖【]([^〗】]+)[〗】]/g)].map(m => m[1]);
    const conditions = tags.map(tag => {
        if (tag === '渾身') return { kind: 'full', interval: null };
        if (tag === '底力') return { kind: 'low', interval: null };
        const accel = /^加速\+?([1-9]\d*)$/.exec(tag);
        if (accel) return { kind: 'accel', interval: Number(accel[1]) };
        const timed = /^時限\+?([1-9]\d*)$/.exec(tag);
        return timed ? { kind: 'timed', interval: Number(timed[1]) } : null;
    }).filter(Boolean);
    const name = String(raw?.name || '(名称なし)').trim();
    if (!conditions.length) {
        const suspicious = tags.find(tag => /^(加速|時限|渾身|底力)/.test(tag)) || (/(?:加速|時限|渾身|底力)/.test(original) ? '該当効果' : null);
        return {entry: null, warning: suspicious
            ? `${name}：条件付きパッシブ「${suspicious}」の書式を認識できません。公式の効果文を確認してください`
            : null};
    }
    if (conditions.length !== 1 ||
        (conditions[0].kind === 'accel' && conditions[0].interval > 20) ||
        (conditions[0].kind === 'timed' && conditions[0].interval > 9999))
        return { entry: null, warning: `${name}：複数・範囲外の条件付きパッシブは未対応です` };
    const tokens = original.replace(/[〖【][^〗】]*[〗】]/g, '').replace(/[、，]/g, ',').split(',').filter(Boolean);
    const modifiers = {}, effects = {};
    for (const token of tokens) {
        const match = /^(.+?)([+-]\d+(?:\.\d+)?)$/.exec(token);
        const key = statAliases[match?.[1]], effect = effectAliases[match?.[1]];
        if (!match || (!key && !effect) || !Number.isFinite(Number(match[2])))
            return { entry: null, warning: `${name}：条件付きパッシブの未対応補正「${token}」を検出したため、自動反映しません` };
        if (key) modifiers[key] = (modifiers[key] || 0) + Number(match[2]);
        else effects[effect] = (effects[effect] || 0) + Number(match[2]);
    }
    if (!Object.keys(modifiers).length && !Object.keys(effects).length)
        return { entry: null, warning: `${name}：条件付きパッシブの能力補正を解析できません` };
    return { entry: {
        ...conditions[0], name, category,
        sourceSkillId: raw?.id == null ? null : String(raw.id), modifiers, effects
    }, warning: null };
}

export function readConditionalPassives(skills) {
    const entries = [], warnings = [], seenSkillIds = new Set();
    for (const [category, list] of [
        ['パッシヴ', skills?.p], ['クラス', skills?.classes], ['エスプリ', skills?.esprits]
    ]) {
        for (const raw of Array.isArray(list) ? list : []) {
            const { entry, warning } = parseConditionalPassive(raw, category);
            if (entry) {
                // The same equipped passive can be surfaced in more than one
                // GraphQL section.  Count it once, but let different IDs stack.
                if (!entry.sourceSkillId || !seenSkillIds.has(entry.sourceSkillId)) {
                    entries.push(entry);
                    if (entry.sourceSkillId) seenSkillIds.add(entry.sourceSkillId);
                }
            }
            if (warning) warnings.push(warning);
        }
    }
    return { entries, warnings };
}

export function validConditionalPassives(value) {
    return Array.isArray(value) && value.length <= 50 && value.every(p =>
        p && typeof p === 'object' && !Array.isArray(p) &&
        Object.hasOwn(PASSIVE_KIND_LABELS, p.kind) &&
        typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 200 &&
        (!['accel', 'timed'].includes(p.kind) ||
            (Number.isInteger(p.interval) && p.interval >= 1 &&
             p.interval <= (p.kind === 'accel' ? 20 : 9999))) &&
        p.modifiers && typeof p.modifiers === 'object' && !Array.isArray(p.modifiers) &&
        Object.keys(p.modifiers).length <= 14 &&
        Object.keys(p.modifiers).every(key => Object.values(statAliases).includes(key)) &&
        Object.values(p.modifiers).every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) &&
        (p.effects === undefined || (p.effects && typeof p.effects === 'object' && !Array.isArray(p.effects) &&
            Object.keys(p.effects).length <= 30 &&
            Object.keys(p.effects).every(key => Object.values(effectAliases).includes(key)) &&
            Object.values(p.effects).every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6))) &&
        (Object.keys(p.modifiers).length > 0 || Object.keys(p.effects || {}).length > 0)
    );
}

/** Official thresholds and the maximum 20 / X acceleration increments. */
function conditionMultiplier(p, turn, hp, maxHp) {
    const ratio = maxHp > 0 ? hp / maxHp : 0;
    // 渾身 is baked into the official imported value. Remove it only
    // when its HP requirement is not met; never add it a second time.
    if (p.kind === 'full') return ratio >= .8 - 1e-12 ? 0 : -1;
    if (p.kind === 'low') return ratio <= .3 + 1e-12 ? 1 : 0;
    // A timed modifier is already included in the imported base value. Remove
    // it on the first turn AFTER X turns have elapsed (turn X+1).
    if (p.kind === 'timed' && Number.isInteger(p.interval) && p.interval > 0)
        return turn > p.interval ? -1 : 0;
    if (p.kind === 'accel' && Number.isInteger(p.interval) && p.interval > 0)
        return Math.min(Math.floor(20 / p.interval), Math.floor(Math.max(0, turn) / p.interval));
    return 0;
}
/**
 * Read-only condition status for the unit editor. The status is derived from
 * the very same multiplier used by Battle.stat(); it does not mutate the
 * official baseline and is never used to make a second combat calculation.
 */
export function conditionalPassiveState(unit, passive, turn = 1, hpPct = 100) {
    const maxHp = Math.max(1, Number(unit?.maxHp) || 1);
    const pct = Math.min(100, Math.max(0, Number(hpPct) || 0));
    const hp = maxHp * pct / 100;
    if (unit?.passivesSuppressed)
        return { label: '抑止中', active: false, multiplier: 0 };
    const multiplier = conditionMultiplier(passive, turn, hp, maxHp);
    if (passive?.kind === 'accel')
        return { label: multiplier > 0 ? `累積 ${multiplier} 回` : '累積前', active: multiplier > 0, multiplier };
    if (passive?.kind === 'timed')
        return { label: multiplier < 0 ? '効果消失' : '効果維持中', active: multiplier === 0, multiplier };
    if (passive?.kind === 'full' || passive?.kind === 'low')
        return { label: multiplier === (passive.kind === 'full' ? 0 : 1) ? '発動中' : '未発動',
            active: multiplier === (passive.kind === 'full' ? 0 : 1), multiplier };
    return { label: '未対応', active: false, multiplier: 0 };
}

export function conditionalPassiveModifier(unit, statKey, turn, hp, maxHp) {
    if (!Array.isArray(unit.conditionalPassives)) return 0;
    return unit.conditionalPassives.reduce((total, p) => total +
        (Number(p?.modifiers?.[statKey]) || 0) *
        (unit.passivesSuppressed ? (p?.kind === 'timed' || p?.kind === 'full' ? -1 : 0) : conditionMultiplier(p, turn, hp, maxHp)), 0);
}
export function conditionalPassiveEffectModifier(unit, effectKey, turn, hp, maxHp) {
    if (unit.passivesSuppressed || !Array.isArray(unit.conditionalPassives)) return 0;
    return unit.conditionalPassives.reduce((total, p) => total +
        (Number(p?.effects?.[effectKey]) || 0) * conditionMultiplier(p, turn, hp, maxHp), 0);
}
/** Base imported values are not modified; provide a read-only effective preview. */
export function passiveStatusPreview(unit, turn = 1, hpPct = unit.startHp ?? 100) {
    const maxHp = Math.max(1, Number(unit.maxHp) || 1);
    const hp = maxHp * Math.max(0, Math.min(100, Number(hpPct) || 0)) / 100;
    const stats = {}, effects = {};
    for (const p of Array.isArray(unit.conditionalPassives) ? unit.conditionalPassives : []) {
        for (const key of Object.keys(p.modifiers || {}))
            stats[key] = conditionalPassiveModifier(unit, key, turn, hp, maxHp);
        for (const key of Object.keys(p.effects || {}))
            effects[key] = (unit.passivesSuppressed ? 0 : (Number(unit.effects?.[key]) || 0)) +
                conditionalPassiveEffectModifier(unit, key, turn, hp, maxHp);
    }
    return {stats, effects};
}

export function conditionalPassiveDescription(passive, statLabels = {}) {
    const kind = PASSIVE_KIND_LABELS[passive.kind] || passive.kind;
    const heading = passive.kind === 'accel' ? `${kind}${passive.interval}（${passive.interval}ターン経過ごと）` :
        passive.kind === 'timed' ? `${kind}${passive.interval}（${passive.interval}ターン経過後に消失）` :
        passive.kind === 'full' ? `${kind}（HP 80％以上）` : `${kind}（HP 30％以下）`;
    const values = Object.entries(passive.modifiers || {}).map(([key, value]) =>
        `${statLabels[key] || key}${value >= 0 ? '+' : ''}${value}`);
    for (const [key, value] of Object.entries(passive.effects || {}))
        values.push(`${Object.entries(effectAliases).find(([, k]) => k === key)?.[0] || key}${value >= 0 ? '+' : ''}${value}`);
    return { heading, values };
}
