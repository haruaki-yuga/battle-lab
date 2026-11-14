import { CATALOG } from './catalog.js';
export const STAT_LABELS = {
    maxHp: '最大HP',
    maxAp: '最大AP',
    main: '主攻撃力',
    sub: '副攻撃力',
    heal: '回復力',
    hit: '命中',
    evade: '回避',
    defense: '防御技術',
    resist: '特殊抵抗',
    speed: '速度',
    mobility: '機動力',
    critical: 'クリティカル',
    fumble: 'ファンブル',
    drama: 'ドラマ'
};
export const SUBJECTS = {
    all: '敵味方のうち誰か',
    self: '自身',
    allies: '自陣営のうち誰か',
    companions: '同行者のうち誰か',
    enemies: '敵のうち誰か',
    previous: '前の条件を満たす対象'
};
export const METRICS = {
    alive: ['が戦闘続行中', '行動', 'bool'],
    actions: ['の現在行動回数が', '行動', '回'],
    av: ['の残行動値が', '行動', ''],
    avDiff: ['の残行動値が自分より', '行動', '低い'],
    active: ['が行動中', '行動', 'bool'],
    waiting: ['が待機中', '行動', 'bool'],
    carrying: ['が行動値持ち越し中', '行動', 'bool'],
    hp: ['のHPが', '状態', ''],
    hpPct: ['のHP割合が', '状態', '%'],
    damage: ['のダメージが', '状態', ''],
    damagePct: ['のダメージ割合が', '状態', '%'],
    ap: ['のAPが', '状態', ''],
    apPct: ['のAP割合が', '状態', '%'],
    apLoss: ['のAP損失が', '状態', ''],
    apLossPct: ['のAP損失割合が', '状態', '%'],
    bsCount: ['のBS数が', '状態', '個'],
    bsTypes: ['のBS種類数が', '状態', '個'],
    buffCount: ['の付与数が', '状態', '個'],
    buffTypes: ['の付与種類数が', '状態', '個'],
    luckLoss: ['の運気減少回数が', '状態', '回'],
    intercept: ['の迎撃が', '状態', '重'],
    retaliate: ['の報復が', '状態', '重'],
    counterTotal: ['の迎撃＋報復が', '状態', '重'],
    coverers: ['をかばえる人数がのべ', '状態', '人'],
    distance: ['との距離が', '状態', 'm'],
    ...Object.fromEntries(Object.entries(STAT_LABELS).filter(([k]) => !['maxHp', 'maxAp'].includes(k)).map(([k, v]) => [k, [`の${v}が`, 'パラメータ', '']]))
};
// Target priority options: legacy keys remain available so saved tactics keep their meaning.
export const TARGET_SORTS = {
    acting: 'で行動中の者',
    waiting: 'で待機中の者',
    carrying: 'で行動値持ち越しの者',
    nearest: 'で最も近い者',
    farthest: 'で最も遠い者',
    hp: 'でHPが最も少ない者',
    hpHigh: 'でHPが最も多い者',
    damageMin: 'でダメージが最も少ない者',
    damageMax: 'でダメージが最も多い者',
    ap: 'でAPが最も少ない者',
    apHigh: 'でAPが最も多い者',
    apLossMin: 'でAP損失が最も少ない者',
    apLossMax: 'でAP損失が最も多い者',
    ...Object.fromEntries(Object.keys(STAT_LABELS).filter(key => !['maxHp', 'maxAp'].includes(key)).flatMap(key => [
        [key + 'Min', `で${STAT_LABELS[key]}が最も低い者`],
        [key + 'Max', `で${STAT_LABELS[key]}が最も高い者`]
    ])),
    hpPct: 'でHP割合が最も低い者（従来）',
    apPct: 'でAP割合が最も低い者（従来）',
    bs: 'でBSが最も多い者（従来）',
    main: 'で主攻撃力が最も高い者（従来）',
    random: 'ランダム（従来）'
};
export const freshTargetCondition = () => ({
    metric: 'hpPct',
    min: 0,
    max: 100,
    not: false,
    bs: []
});
// Mixed target criteria: filter rows and preference rows can be added in one picker.
// Legacy targetConditions/sort values are exposed as equivalent rows until edited.
export const freshTargetCriterion = () => ({
    type: 'filter',
    metric: 'hpPct',
    min: 0,
    max: 100,
    not: false,
    bs: []
});
export function targetCriteriaForRule(rule) {
    if (Array.isArray(rule.targetCriteria))
        return rule.targetCriteria;
    return [...(Array.isArray(rule.targetConditions) ? rule.targetConditions : []).map(c => ({ ...c, type: 'filter' })),
        { type: 'sort', sort: TARGET_SORTS[rule.sort] ? rule.sort : 'nearest' }];
}
export function ensureTargetCriteria(rule) {
    if (!Array.isArray(rule.targetCriteria))
        rule.targetCriteria = targetCriteriaForRule(rule);
    return rule.targetCriteria;
}
export const ACTIONS = {
    attack: '通常攻撃',
    skill: '指定アクティブスキル',
    effectiveAttack: '効果的な攻撃',
    healHP: '効果的なHP回復スキル',
    healAP: '効果的なAP回復スキル',
    healBS: '効果的なBS回復スキル',
    focusAttack: '攻撃集中',
    focusDefense: '防御集中',
    block: 'ブロック',
    cover: '庇う',
    move: '移動のみ',
    wait: '待機',
    carry: '行動値持ち越し'
};
export const RANGES = {
    touch: '至近 / 3m',
    near: '近接 / 10m',
    mid: '中距離 / 20m',
    far: '遠距離 / 30m',
    super: '超遠 / 40m',
    special: '特レ / 指定距離'
};
export const SCOPES = {
    single: '単体',
    random: 'ランダム',
    self: '自身',
    area: '範囲 / 半径5m',
    wide: '広域 / 半径10m',
    selfArea: '自範 / 半径5m',
    selfWide: '自域 / 半径10m',
    pierce: '貫通',
    cone: '扇',
    line: '列',
    special: '特殊 / 指定半径'
};
export const SKILL_KINDS = {
    attack: '攻撃',
    hp: 'HP回復',
    ap: 'AP回復',
    ha: 'HP・AP回復',
    cleanse: 'BS回復',
    buff: '付与'
};
export const EFFECTS = {
    side: '副',
    versatile: '万能',
    identify: '識別',
    noDamage: 'ダ無',
    sureHit: '必中',
    dash: '移',
    knockback: '飛',
    reflect: '反',
    thorns: '棘',
    break: 'ブレイク',
    nonlethal: '不殺',
    curseKill: '呪殺',
    reverse: '逆凪',
    revenge: '復讐',
    clever: '巧妙',
    steady: '堅実',
    multiShadow: '多重影',
    evil: '邪道',
    demon: '鬼道',
    healEfficiency: '回復効率',
    regen: '再生',
    charge: '充填',
    efficiency: '能率',
    dot: 'ダメージ',
    lost: 'ロスト',
    erosion: '摩耗',
    hpDrain: 'HP吸収',
    apDrain: 'AP吸収',
    haDrain: 'HA吸収',
    offensiveCleanse: '攻勢BS回復',
    bsHeal: 'BS回復',
    hpArmor: 'HP鎧',
    apArmor: 'AP鎧',
    bsArmor: 'BS鎧',
    bsEase: 'BS緩和',
    splash: 'スプラッシュ',
    pursuit: '追撃',
    weak: '弱点',
    curve: '曲射',
    heavy: '重甲',
    recoil: '反動',
    chargeTime: '溜',
    fastCast: '高速詠唱',
    bind: '拘束',
    lethal: '必殺',
    radiance: '光輝',
    breakGuard: 'ブレイクガード',
    extraHP: '追加HP回復'
};
export const BOOL_EFFECTS = [
    'side',
    'versatile',
    'identify',
    'noDamage',
    'sureHit',
    'dash',
    'knockback',
    'reflect',
    'thorns',
    'break',
    'nonlethal',
    'curseKill',
    'reverse'
];
export const BS_GROUPS = [
    ['毒', '猛毒', '致死毒', '廃滅'],
    ['火炎', '業炎', '炎獄', '紅焔'],
    ['凍結', '氷結', '氷漬', '絶凍'],
    ['痺れ', 'ショック', '感電', '雷陣'],
    ['乱れ', '崩れ', '体勢不利', '崩落'],
    ['出血', '流血', '失血', '滂沱'],
    ['窒息', '苦鳴', '懊悩', '無常'],
    ['足止', '泥沼', '停滞', '退化'],
    ['不調', '不遇', '不発', '奈落'],
    ['鈍り', '欠刃', '錆付', '腐朽'],
    ['不吉', '不運', '魔凶', '塔'],
    ['軟化', '弱体', '脆弱', '伽藍'],
    ['麻痺', '呪縛', '石化'],
    ['混乱', '狂気', '魅了'],
    ['怒り', '激怒', '赫怒', '逆上']
];
export const BS_NAMES = [
    ...BS_GROUPS.flat(),
    '呪い',
    '致命',
    '封印',
    '暗闇',
    '恍惚',
    '重圧',
    '無策'
];
export const freshCondition = () => ({
    type: 'who',
    subject: 'enemies',
    metric: 'alive',
    min: 0,
    max: 100,
    not: false,
    bs: [],
    multiple: 1,
    offset: 1,
    chance: 50
});
let nextId = 0;
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${++nextId}`;
// Map retired fourth positioning mode to the official three choices.
export function normalizeMoveModes(config) {
    for (const u of config?.units || [])
        for (const r of u.rules || []) {
            if (r.moveMode === 'kite')
                r.moveMode = 'fixed';
        }
    return config;
}
export function freshRule(overrides = {}) {
    return {
        id: uid('r'),
        enabled: true,
        conditions: [freshCondition()],
        action: 'attack',
        skillId: '',
        target: 'enemies',
        sort: 'nearest',
        targetConditions: [],
        autoMove: true,
        moveMode: 'fixed',
        minDist: 0,
        maxDist: 3,
        splitMovement: false,
        moveTargetMode: 'same',
        moveSubject: 'previous',
        moveUnitId: '',
        moveConditions: [],
        moveSort: 'nearest',
        movePriority: 'action',
        ...overrides
    };
}
export function freshSkill(overrides = {}) {
    return {
        id: uid('s'),
        name: '新しいスキル',
        kind: 'attack',
        ap: 100,
        cost: 70,
        range: 'near',
        scope: 'single',
        customRange: 20,
        radius: 5,
        mainPct: 100,
        mainBonus: 100,
        subPct: 100,
        subBonus: 0,
        hitBonus: 0,
        power: 100,
        bs: [],
        bsTurns: 3,
        buffTurns: 8,
        modifiers: {},
        effects: { identify: 1 },
        trigger: 'instant',
        passiveWhen: 'always',
        interval: 1,
        note: '',
        ...overrides
    };
}
export function freshUnit(overrides = {}) {
    return {
        id: uid('u'),
        name: '新しいユニット',
        team: 'A',
        maxHp: 6000,
        maxAp: 2400,
        main: 650,
        sub: 120,
        heal: 250,
        hit: 65,
        evade: 40,
        defense: 35,
        resist: 30,
        speed: 180,
        mobility: 2,
        critical: 8,
        fumble: 3,
        drama: 10,
        startHp: 100,
        startAp: 100,
        x: -10,
        y: 0,
        normalRange: 'near',
        effects: {},
        initialBS: [],
        immunities: [],
        skills: ['wiki-001', 'wiki-041'],
        rules: [freshRule({ action: 'effectiveAttack' }), freshRule({ conditions: [], action: 'carry', autoMove: false, target: 'self' })],
        ...overrides
    };
}
// X: 10m either side of arena centre (20m between teams).
// Y: evenly spaced at 5m with the team's midpoint on the horizontal centre line.
export function arrangeInitialPositions(units) {
    for (const team of ['A', 'B']) {
        const members = units.filter(u => u.team === team);
        members.forEach((u, i) => {
            u.x = team === 'A' ? -10 : 10;
            u.y = (i - (members.length - 1) / 2) * 5;
        });
    }
    return units;
}
// Initial example teams use only official WIKI A-skills; no non-WIKI starter skills are bundled.
export function sampleConfig() {
    const units = [
        freshUnit({
            id: 'a1',
            name: 'アタッカー',
            skills: ['wiki-001', 'wiki-041'],
            x: -10,
            y: -2.5
        }),
        freshUnit({
            id: 'a2',
            name: 'サポーター',
            main: 300,
            sub: 70,
            heal: 450,
            speed: 150,
            x: -10,
            y: 2.5,
            skills: ['wiki-212', 'wiki-202'],
            rules: [
                freshRule({
                    conditions: [{
                            ...freshCondition(),
                            subject: 'allies',
                            metric: 'hpPct',
                            min: 0,
                            max: 60
                        }],
                    action: 'healHP',
                    target: 'previous',
                    sort: 'hpPct',
                    maxDist: 18
                }),
                freshRule({ conditions: [], action: 'attack', maxDist: 8 })
            ]
        }),
        freshUnit({
            id: 'b1',
            name: 'ディフェンダー',
            team: 'B',
            maxHp: 8000,
            main: 550,
            defense: 60,
            evade: 20,
            speed: 140,
            x: 10,
            y: -2.5,
            skills: ['wiki-001'],
            rules: [
                freshRule({
                    conditions: [{
                            ...freshCondition(),
                            subject: 'self',
                            metric: 'actions',
                            min: 0,
                            max: 0
                        }],
                    action: 'focusDefense',
                    target: 'self',
                    autoMove: false
                }),
                freshRule({ action: 'effectiveAttack', maxDist: 8 })
            ]
        }),
        freshUnit({
            id: 'b2',
            name: 'チームBのキャラクター',
            team: 'B',
            maxHp: 5000,
            main: 500,
            hit: 85,
            evade: 70,
            speed: 230,
            x: 10,
            y: 2.5,
            normalRange: 'far',
            skills: ['wiki-018', 'wiki-021'],
            rules: [
                freshRule({ action: 'skill', skillId: 'wiki-018', minDist: 21, maxDist: 29 }),
                freshRule({ conditions: [], action: 'attack', minDist: 21, maxDist: 29 })
            ]
        })
    ];
    return {
        version: 1,
        initialLayoutVersion: 2,
        name: 'チーム戦・初期編成',
        settings: {
            turns: 20,
            seed: 'ARCADIA-01',
            seedMode: 'auto',
            rangePolicy: 'text',
            combatMode: 'official',
            mapSize: 150,
            moveCost: 40
        },
        units,
        skills: CATALOG.map(s => JSON.parse(JSON.stringify(s)))
    };
}
export const clone = o => JSON.parse(JSON.stringify(o));
export function validateConfig(c) {
    const errors = [];
    if (!c || c.version !== 1 || !Array.isArray(c.units) || !Array.isArray(c.skills) || !c.settings)
        return ['対応する設定JSON（version: 1）ではありません。'];
    if (c.units.length < 2 || c.units.length > 16)
        errors.push('ユニットは2～16人にしてください。');
    if (!c.units.some(u => u.team === 'A') || !c.units.some(u => u.team === 'B'))
        errors.push('両チームに1人以上必要です。');
    const ids = new Set();
    for (const s of c.skills) {
        if (!s.id || ids.has(s.id))
            errors.push('スキルIDが重複しています。');
        ids.add(s.id);
        if (!s.name?.trim() || !SKILL_KINDS[s.kind] || !RANGES[s.range] || !SCOPES[s.scope])
            errors.push('スキルの名前・分類・射程・範囲を確認してください。');
        for (const k of [
            'ap',
            'cost',
            'mainPct',
            'mainBonus',
            'subPct',
            'subBonus',
            'hitBonus',
            'power'
        ])
            if (!Number.isFinite(s[k]))
                errors.push(`${s.name}: ${k}は数値で指定してください。`);
        if (s.ap < 0 || (s.kind !== 'passive' && (s.cost < 0 || s.cost + (s.effects?.chargeTime || 0) < 1)))
            errors.push(`${s.name}: 消費AP・行動値は0以上、行動値＋溜は1以上です。`);
        if (!Array.isArray(s.bs) || s.bs.some(b => !BS_NAMES.includes(b)))
            errors.push(`${s.name}: BS指定が不正です。`);
        if (!s.effects || !s.modifiers)
            errors.push(`${s.name}: 効果情報がありません。`);
    }
    const uids = new Set();
    for (const u of c.units) {
        if (!u.id || uids.has(u.id))
            errors.push('ユニットIDが重複しています。');
        uids.add(u.id);
        if (!u.name?.trim() || !['A', 'B'].includes(u.team))
            errors.push('ユニットの名前と陣営を確認してください。');
        for (const k of [
            ...Object.keys(STAT_LABELS),
            'x',
            'y',
            'startHp',
            'startAp'
        ])
            if (!Number.isFinite(u[k]))
                errors.push(`${u.name}: ${k}は数値で指定してください。`);
        if (u.maxHp < 1 || u.maxAp < 0 || u.mobility < 0)
            errors.push(`${u.name}: HPは1以上、AP・機動力は0以上です。`);
        if (!Array.isArray(u.rules) || !Array.isArray(u.skills)) {
            errors.push(`${u.name}: ルール・装備スキルがありません。`);
            continue;
        }
        if (u.skills.some(id => !ids.has(id)))
            errors.push(`${u.name}: 存在しないスキルが装備されています。`);
        for (const r of u.rules) {
            if (!Array.isArray(r.conditions) || !ACTIONS[r.action]) {
                errors.push(`${u.name}: 行動設定が不正です。`);
                continue;
            }
            if (r.enabled && r.action === 'skill' && !u.skills.includes(r.skillId))
                errors.push(`${u.name}: 指定スキルを装備するか、行動を変更してください。`);
            if (r.minDist > r.maxDist)
                errors.push(`${u.name}: 移動距離の下限が上限を超えています。`);
            if (!['fixed', 'approach', 'away'].includes(r.moveMode))
                errors.push(`${u.name}: 自動位置取りの方法は固定移動指定・近付く・離れるの3種類から選んでください。`);
            if (r.splitMovement && r.moveTargetMode === 'individual') {
                if (![
                    'all',
                    'self',
                    'allies',
                    'companions',
                    'enemies',
                    'previous',
                    'id'
                ].includes(r.moveSubject))
                    errors.push(`${u.name}: 移動基準の対象が不正です。`);
                if (r.moveSubject === 'id' && !c.units.some(t => t.id === r.moveUnitId))
                    errors.push(`${u.name}: 移動基準の指定IDが存在しません。`);
                if (r.movePriority && !['action', 'movement'].includes(r.movePriority))
                    errors.push(`${u.name}: 行使・移動の優先順位が不正です。`);
                if (!Array.isArray(r.moveConditions))
                    errors.push(`${u.name}: 移動の追加条件が不正です。`);
            }
            if (r.targetConditions !== undefined && !Array.isArray(r.targetConditions))
                errors.push(`${u.name}: 対象の追加条件は配列で指定してください。`);
            if (r.targetCriteria !== undefined) {
                if (!Array.isArray(r.targetCriteria))
                    errors.push(`${u.name}: 対象選択の条件は配列で指定してください。`);
                else if (r.targetCriteria.length > 100)
                    errors.push(`${u.name}: 対象選択の条件は100件以内にしてください。`);
                else
                    for (const q of r.targetCriteria) {
                        if (!q || typeof q !== 'object' || (q.type !== 'sort' && q.type !== 'filter')) {
                            errors.push(`${u.name}: 対象選択の条件種類が不正です。`);
                            continue;
                        }
                        if (q.type === 'sort' && !TARGET_SORTS[q.sort])
                            errors.push(`${u.name}: 対象選択の優先条件が不正です。`);
                        if (q.type === 'filter' && (!METRICS[q.metric] || !Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min > q.max || q.not !== undefined && typeof q.not !== 'boolean' || q.bs !== undefined && (!Array.isArray(q.bs) || q.bs.some(bs => !BS_NAMES.includes(bs)))))
                            errors.push(`${u.name}: 対象選択の数値・BS条件が不正です。`);
                    }
            }
            if (r.sort !== undefined && !TARGET_SORTS[r.sort])
                errors.push(`${u.name}: 対象の優先条件が不正です。`);
            if (r.moveSort !== undefined && !TARGET_SORTS[r.moveSort])
                errors.push(`${u.name}: 移動基準の優先条件が不正です。`);
            for (const q of Array.isArray(r.targetConditions) ? r.targetConditions : []) {
                if (!METRICS[q.metric] || !Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min > q.max || q.not !== undefined && typeof q.not !== 'boolean' || q.bs !== undefined && (!Array.isArray(q.bs) || q.bs.some(bs => !BS_NAMES.includes(bs))))
                    errors.push(`${u.name}: 対象の追加条件の項目・範囲を確認してください。`);
            }
            for (const q of [...r.conditions, ...(r.splitMovement && r.moveTargetMode === 'individual' && Array.isArray(r.moveConditions) ? r.moveConditions : [])]) {
                if (q.type === 'who' && (!SUBJECTS[q.subject] || !METRICS[q.metric] || !Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min > q.max))
                    errors.push(`${u.name}: 条件の項目・範囲を確認してください。`);
                if (q.type === 'turn' && (!Number.isFinite(q.multiple) || q.multiple < 1 || !Number.isFinite(q.offset) || q.offset < 0))
                    errors.push(`${u.name}: ターン条件は倍数1以上、加算0以上です。`);
                if (q.type === 'chance' && (!Number.isFinite(q.chance) || q.chance < 0 || q.chance > 100))
                    errors.push(`${u.name}: 確率は0～100%です。`);
            }
        }
    }
    if (c.settings.combatMode !== undefined && c.settings.combatMode !== 'official')
        errors.push('戦闘ルールの設定が不正です。');
    if (!Number.isInteger(c.settings.turns) || c.settings.turns < 1 || c.settings.turns > 200)
        errors.push('最大ターン数は1～200です。');
    return [...new Set(errors)];
}
