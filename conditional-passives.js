/**
 * Official Lost Arcadia conditional passive parameters.
 * The character-profile sub_status values remain the imported base statistics.
 * 渾身/底力 grant their skill-defined modifiers while their HP condition holds.
 * 加速 grants one additional copy of the listed modifier at each Nth
 * battle turn (up to floor(20 / N) copies), relative to imported profile stats.
 */
export const PASSIVE_KIND_LABELS = Object.freeze({ accel: '加速', full: '渾身', low: '底力' });

const statAliases = Object.freeze({
    HP: 'maxHp', AP: 'maxAp',
    主攻: 'main', 主攻撃力: 'main', 副攻: 'sub', 副攻撃力: 'sub',
    回復: 'heal', 回復力: 'heal', 命中: 'hit', 回避: 'evade',
    防技: 'defense', 防御技術: 'defense', 抵抗: 'resist', 特殊抵抗: 'resist',
    速度: 'speed', 機動: 'mobility', 機動力: 'mobility',
    CT: 'critical', クリティカル: 'critical', FB: 'fumble', ファンブル: 'fumble', ドラマ: 'drama'
});

export function parseConditionalPassive(raw, category = 'パッシヴ') {
    const original = String(raw?.display_effects ?? '').normalize('NFKC').replace(/\s+/g, '');
    const tags = [...original.matchAll(/[〖【]([^〗】]+)[〗】]/g)].map(m => m[1]);
    const conditions = tags.map(tag => {
        if (tag === '渾身') return { kind: 'full', interval: null };
        if (tag === '底力') return { kind: 'low', interval: null };
        const match = /^加速([1-9]\d*)$/.exec(tag);
        return match ? { kind: 'accel', interval: Number(match[1]) } : null;
    }).filter(Boolean);
    if (!conditions.length) return { entry: null, warning: null };
    const name = String(raw?.name || '(名称なし)').trim();
    if (conditions.length !== 1 || (conditions[0].kind === 'accel' && conditions[0].interval > 20))
        return { entry: null, warning: `${name}：複数・範囲外の条件付きパッシブは未対応です` };
    const tokens = original.replace(/[〖【][^〗】]*[〗】]/g, '').replace(/[、，]/g, ',').split(',').filter(Boolean);
    const modifiers = {};
    for (const token of tokens) {
        const match = /^(.+?)([+-]\d+(?:\.\d+)?)$/.exec(token);
        const key = statAliases[match?.[1]];
        if (!match || !key || !Number.isFinite(Number(match[2])))
            return { entry: null, warning: `${name}：条件付きパッシブの未対応補正「${token}」を検出したため、自動反映しません` };
        modifiers[key] = (modifiers[key] || 0) + Number(match[2]);
    }
    if (!Object.keys(modifiers).length)
        return { entry: null, warning: `${name}：条件付きパッシブの能力補正を解析できません` };
    return { entry: {
        ...conditions[0], name, category,
        sourceSkillId: raw?.id == null ? null : String(raw.id), modifiers
    }, warning: null };
}

export function readConditionalPassives(skills) {
    const entries = [], warnings = [];
    for (const [category, list] of [
        ['パッシヴ', skills?.p], ['クラス', skills?.classes], ['エスプリ', skills?.esprits]
    ]) {
        for (const raw of Array.isArray(list) ? list : []) {
            const { entry, warning } = parseConditionalPassive(raw, category);
            if (entry) entries.push(entry);
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
        (p.kind !== 'accel' || (Number.isInteger(p.interval) && p.interval >= 1 && p.interval <= 20)) &&
        p.modifiers && typeof p.modifiers === 'object' && !Array.isArray(p.modifiers) &&
        Object.keys(p.modifiers).length > 0 && Object.keys(p.modifiers).length <= 14 &&
        Object.keys(p.modifiers).every(key => Object.values(statAliases).includes(key)) &&
        Object.values(p.modifiers).every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6)
    );
}

/** The cap and number of increments follow the official 20 / X rule. */
export function conditionalPassiveModifier(unit, statKey, turn, hp, maxHp) {
    if (unit.passivesSuppressed) return 0;
    const list = unit.conditionalPassives;
    if (!Array.isArray(list) || !list.length) return 0;
    const healthRatio = maxHp > 0 ? hp / maxHp : 0;
    let total = 0;
    for (const p of list) {
        const amount = Number(p?.modifiers?.[statKey]) || 0;
        if (!amount) continue;
        if (p.kind === 'full' && healthRatio >= .8 - 1e-12) total += amount;
        else if (p.kind === 'low' && healthRatio <= .3 + 1e-12) total += amount;
        else if (p.kind === 'accel' && Number.isInteger(p.interval) && p.interval > 0)
            total += amount * Math.min(Math.floor(20 / p.interval), Math.floor(Math.max(0, turn) / p.interval));
    }
    return total;
}

export function conditionalPassiveDescription(passive, statLabels = {}) {
    const kind = PASSIVE_KIND_LABELS[passive.kind] || passive.kind;
    const heading = passive.kind === 'accel' ? `${kind}${passive.interval}（${passive.interval}ターン経過ごと）` :
        passive.kind === 'full' ? `${kind}（HP 80％以上）` : `${kind}（HP 30％以下）`;
    const values = Object.entries(passive.modifiers || {}).map(([key, value]) =>
        `${statLabels[key] || key}${value >= 0 ? '+' : ''}${value}`);
    return { heading, values };
}
