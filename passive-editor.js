/**
 * Conditional passive presets transcribed from the user-specified community wiki:
 * https://c01301.sakura.ne.jp/rev2_wiki/doku.php?id=パッシブ
 * This is an OFFLINE editor catalogue, never a live request to the wiki.
 * Only passives with the four supported battle conditions are included.
 * Presets are manual additions, not official-imported base stats.
 */
export const CONDITIONAL_PASSIVE_TEMPLATES = Object.freeze([
  { id:'focus',name:'集中力',kind:'low',modifiers:{speed:12,evade:3} },
  { id:'high-spirits',name:'調子乗り',kind:'full',modifiers:{speed:12,hit:3} },
  { id:'acceleration',name:'加速',kind:'accel',interval:5,modifiers:{speed:2,hit:1} },
  { id:'quick-start',name:'初速',kind:'timed',interval:5,modifiers:{main:15,sub:15,hit:3} },
  { id:'last-stand',name:'底力',kind:'low',modifiers:{speed:24,evade:6} },
  { id:'dominance',name:'一気呵成',kind:'full',modifiers:{speed:24,hit:6} },
  { id:'blitz',name:'電撃戦',kind:'timed',interval:5,modifiers:{main:30,sub:30,hit:6} },
  { id:'amplified-acceleration',name:'増幅加速',kind:'accel',interval:4,modifiers:{speed:4,hit:1,evade:1} },
  { id:'reversal-magic',name:'逆転魔術',kind:'low',modifiers:{speed:24,hit:8,fumble:-1} },
  { id:'attack-master',name:'攻め達磨',kind:'full',modifiers:{speed:24,hit:8,critical:1} },
  { id:'protagonist',name:'主人公力',kind:'accel',interval:4,modifiers:{speed:10,hit:1,evade:1} },
  { id:'accelerate-over',name:'アクセルオーバー',kind:'timed',interval:5,modifiers:{main:50,sub:50,hit:8} },
  { id:'rubi-maiden',name:'ルヴィメイデン',kind:'low',modifiers:{defense:-5,resist:-5,speed:6,evade:-10,drama:25}, note:'ザフィーアメイデン装備時のみ（装備条件は自動判定しません）' }
]);
export const CONDITIONAL_KIND_OPTIONS = Object.freeze({full:'渾身（HP80%以上）',low:'底力（HP30%以下）',accel:'加速（指定ターンごと）',timed:'時限（指定ターン後消失）'});

/**
 * Skill definitions imported from the official profile, and named presets,
 * are reference data. Only a user's explicit free-form entry may be edited.
 * Older v1.18 named presets did not have `presetId`; recognise them by their
 * catalogue name/kind without changing the stored modifiers.
 */
export function isFixedConditionalPassive(p) {
    if (!p || typeof p !== 'object' || p.custom === true) return false;
    if (CONDITIONAL_PASSIVE_TEMPLATES.some(t => t.id === p.presetId)) return true;
    if (p.category === '手動追加' && p.baselineIncluded === false)
        return CONDITIONAL_PASSIVE_TEMPLATES.some(t => t.name === p.name && t.kind === p.kind);
    return p.sourceSkillId != null || p.baselineIncluded !== false;
}
const isIncluded = p => ['full','timed'].includes(p?.kind) && p.baselineIncluded !== false;
const safeNumber = n => typeof n === 'number' && Number.isFinite(n) ? n : 0;
/** When removing/editing official-included 渾身/時限, rebalance imported base values. */
export function applyPassiveEditor(unit, revised, editedEffects = unit.effects) {
    if (!Array.isArray(revised) || revised.length > 50) throw Error('条件付きパッシブが多すぎます。');
    const next = { ...unit, effects: { ...editedEffects }, conditionalPassives: revised.map(p => ({...p, modifiers:{...p.modifiers}, effects:{...(p.effects||{})}})) };
    // Subtract all old included bonuses; then add all new included bonuses.
    // This guarantees deleting/revising an imported passive never leaves its
    // baked-in stat bonus permanently active.
    for (const [source, sign] of [[unit.conditionalPassives || [], -1], [next.conditionalPassives, 1]]) {
        for (const p of source) {
            if (!isIncluded(p)) continue;
            for (const [key, value] of Object.entries(p.modifiers || {})) {
                if (typeof next[key] === 'number') next[key] += sign * safeNumber(value);
            }
            for (const [key, value] of Object.entries(p.effects || {})) {
                // An explicitly removed permanent effect must stay removed.
                if (!Object.hasOwn(editedEffects, key)) continue;
                next.effects[key] = safeNumber(next.effects[key]) + sign * safeNumber(value);
                if (next.effects[key] === 0) delete next.effects[key];
            }
        }
    }
    return next;
}
export function makePresetPassive(id) {
    const p = CONDITIONAL_PASSIVE_TEMPLATES.find(item=>item.id===id);
    if (!p) throw Error('Wiki掲載パッシブを選択してください。');
    return { kind:p.kind, interval:p.interval??null, name:p.name, presetId:p.id, category:'手動追加',sourceSkillId:null,
        baselineIncluded:false,modifiers:{...p.modifiers},effects:{},...(p.note?{note:p.note}:{}) };
}
export function makeCustomPassive(kind) {
    if (!Object.hasOwn(CONDITIONAL_KIND_OPTIONS,kind)) throw Error('パッシブ種別を選択してください。');
    return {kind, interval:['accel','timed'].includes(kind)?5:null, name:'任意の条件付きパッシブ',custom:true,
        category:'手動追加',sourceSkillId:null,baselineIncluded:false,modifiers:{speed:1},effects:{}};
}
