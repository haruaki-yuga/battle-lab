// Convert a Battle Lab unit's selected tactics to the official Arena EncodeArenaSettings input.
// Fail closed on non-representable settings; never silently weaken, skip, or substitute a rule.
import { ARENA_MAX_RULES, ARENA_MAX_CONDITIONS, targetCriteriaForRule } from './model.js';
import {
  OFFICIAL_AI, OFFICIAL_SUBJECT_KEYS, OFFICIAL_TARGET_KEYS,
  OFFICIAL_ACTION_KEYS, OFFICIAL_MOVE_KEYS, OFFICIAL_METRIC_KEYS,
  OFFICIAL_SORT_KEYS, OFFICIAL_CONDITION_SPECS
} from './official-ai-schema.js?v=1.17.18';

const inverse = obj => new Map(Object.entries(obj).map(([key, value]) => [value, key]));
const SUBJECT = inverse(OFFICIAL_SUBJECT_KEYS);
const TARGET = inverse(OFFICIAL_TARGET_KEYS);
const ACTION = inverse(OFFICIAL_ACTION_KEYS);
const MOVE = inverse(OFFICIAL_MOVE_KEYS);
const METRIC = inverse(OFFICIAL_METRIC_KEYS);
const SORT = inverse(OFFICIAL_SORT_KEYS);
const BS = new Map(OFFICIAL_AI.badStatuses.map(x => [x.name, String(x.id)]));
const isObj = value => value != null && typeof value === 'object' && !Array.isArray(value);
const finiteInt = value => typeof value === 'number' && Number.isSafeInteger(value);
const problem = (line, message) => Error(`${line}行目：${message}`);
function checkedRange(value, row, line) {
  if (!finiteInt(value?.min) || !finiteInt(value?.max) || value.min > value.max ||
      value.min < row.range_min || value.max > row.range_max)
    throw problem(line, `${row.condition_name || row.target_name}の数値範囲は${row.range_min}～${row.range_max}の整数にしてください。`);
}
function characterId(config, localId, line) {
  const unit = config.units.find(u => u.id === localId);
  const official = String(unit?.importedProfile?.characterId || '').trim();
  if (!/^r2p\d{6}$/.test(official)) throw problem(line, 'ID指定に対応する公式キャラクターIDを確認できません。キャラURLから取り込み直してください。');
  return official;
}
function conditionParams(condition, line, target = false) {
  if (!isObj(condition)) throw problem(line, '条件データが不正です。');
  const sort = target && condition.type === 'sort';
  const name = sort ? SORT.get(condition.sort) : METRIC.get(condition.metric);
  if (!name) throw problem(line, `公式未対応の${target ? '対象優先' : '条件'}：${condition.sort || condition.metric || ''}`);
  const spec = OFFICIAL_AI.actionSubjectConditions.find(x => x.type === name);
  if (!spec || (target ? (!spec.target_name || spec.target_name === '-') && name !== 'IsActive' : !spec.condition_name))
    throw problem(line, `公式では指定できない条件：${name}`);
  if (sort && condition.not) throw problem(line, '優先対象条件に否定を設定できません。');
  const hasRange = !!spec.has_range;
  if (hasRange) checkedRange(condition, spec, line);
  const names = Array.isArray(condition.bs) ? condition.bs : [];
  if (names.length && !spec.has_bs_list) throw problem(line, 'この条件ではBS種類指定が使えません。');
  if (names.some(n => !BS.has(n))) throw problem(line, '公式にないBSが指定されています。');
  return {
    character_id: null, condition_type: name,
    param1: hasRange ? condition.min : null,
    param2: hasRange ? condition.max : null,
    bs_list: names.length ? [...new Set(names.map(n => BS.get(n)))] : null,
    negate: !!condition.not
  };
}
function encodeCondition(c, config, line) {
  if (!isObj(c)) throw problem(line, '発動条件が不正です。');
  if (c.type === 'turn') {
    if (!finiteInt(c.multiple) || c.multiple < 1 || c.multiple > 10 ||
        !finiteInt(c.offset) || c.offset < 0 || c.offset > 10)
      throw problem(line, 'ターン条件の周期・開始位置を確認してください。');
    return {subject: 'Turn', params: {character_id:null, condition_type:null,
      param1:c.multiple, param2:c.offset, bs_list:null, negate:!!c.not}};
  }
  if (c.type === 'afterWait') return {subject:'AfterWaiting',params:{character_id:null,
    condition_type:null,param1:null,param2:null,bs_list:null,negate:!!c.not}};
  if (c.type === 'chance') {
    if (!finiteInt(c.chance) || c.chance < 0 || c.chance > 100)
      throw problem(line, '確率は0～100％で指定してください。');
    return {subject:'Probability',params:{character_id:null,condition_type:null,
      param1:c.chance,param2:null,bs_list:null,negate:!!c.not}};
  }
  if (c.type !== 'who') throw problem(line, `公式未対応の条件タイプ：${c.type}`);
  const subject = SUBJECT.get(c.subject);
  if (!subject || !OFFICIAL_AI.actionSubjects.some(x => x.type === subject && x.has_sub_conditions))
    throw problem(line, `公式未対応の判定対象：${c.subject}`);
  const params = conditionParams(c,line);
  if (subject === 'ID') params.character_id = characterId(config,c.characterId,line);
  return {subject,params};
}
function encodeTarget(subject, unitId, criteria, config, line) {
  const type = TARGET.get(subject);
  if (!type) throw problem(line, `公式未対応の行使対象：${subject}`);
  if (!Array.isArray(criteria) || criteria.length > 1)
    throw problem(line, '公式は行使対象に条件を1件だけ指定できます。複数の対象条件は整理してください。');
  const criterion = criteria[0];
  const params = criterion ? conditionParams(criterion, line, true) : {
    character_id: null, condition_type:'IsActive', param1:null,param2:null,
    bs_list:null,negate:false
  };
  if (type === 'ID') params.character_id = characterId(config, unitId, line);
  return {target: type,params};
}
function officialSkillId(rule, unit, config, line) {
  const skill = config.skills.find(s => s.id === rule.skillId && unit.skills.includes(s.id));
  if (!skill) throw problem(line, '指定アクティブスキルが装備されていません。');
  const ids = [unit.officialSkillIds?.[skill.id], unit.specializedSkills?.[skill.id]?.originSkillId,
    skill.originSkillId,skill.importedFromCharacter?.originalId,skill.importedFromCharacter?.skillId,
    skill.importedProfile?.skillId,rule.arenaSkillId];
  const recognized = [...new Set(ids.filter(x=> x!=null && /^\d+$/.test(String(x))).map(String))];
  if (!recognized.length) throw problem(line, `「${skill.name}」の公式スキルIDが不明です。キャラURLから再取得してください。`);
  if (recognized.length > 1) throw problem(line, `「${skill.name}」に複数の公式スキルIDがあり、正しいIDを特定できません。`);
  return recognized[0];
}
function optionalDist(value, line) {
  if (value === null || value === undefined || value === '') return null;
  if (!finiteInt(value) || value < 0 || value > 999)
    throw problem(line,'距離は0～999mの整数にしてください。');
  return value;
}
function encodeRule(rule, unit, config, line) {
  if (!isObj(rule) || !Array.isArray(rule.conditions) || rule.conditions.length > ARENA_MAX_CONDITIONS)
    throw problem(line, `発動条件は最大${ARENA_MAX_CONDITIONS}件です。`);
  const maneuver = ACTION.get(rule.action);
  if (!maneuver || maneuver === 'AutoMove') throw problem(line, `公式未対応の行動：${rule.action}`);
  const maneuverSpec = OFFICIAL_AI.maneuvers.find(x => x.type === maneuver);
  const moveMode = MOVE.get(rule.moveMode || 'fixed');
  if (!moveMode) throw problem(line, `公式未対応の移動方法：${rule.moveMode}`);
  const min = optionalDist(rule.minDist,line), max=optionalDist(rule.maxDist,line);
  if (min!==null && max!==null && min>max) throw problem(line,'最短距離が最長距離を超えています。');
  if (rule.splitMovement && rule.moveTargetMode !== 'individual')
    throw problem(line, '独立した移動対象の設定が不明です。');
  const extra = rule.splitMovement ? (() => {
    if (Array.isArray(rule.moveConditions) && rule.moveConditions.length)
      throw problem(line, '移動対象の複数条件は公式共有形式に安全に変換できません。');
    if (!['action','movement'].includes(rule.movePriority || 'action'))
      throw problem(line, '移動優先設定が不正です。');
    return {move_target: encodeTarget(rule.moveSubject, rule.moveUnitId,
      [{type:'sort',sort:rule.moveSort||'nearest'}],config,line),
      move_priority: rule.movePriority === 'movement' ? 'Move' : 'Action'};
  })() : {move_target:null,move_priority:null};
  const candidates = targetCriteriaForRule(rule);
  const target = encodeTarget(rule.target, rule.targetUnitId,candidates,config,line);
  return {active:!!rule.enabled,
    conditions:rule.conditions.map(c => encodeCondition(c,config,line)),
    maneuver: {
      maneuver, skill_id:maneuver === 'SpecificSkill' ? officialSkillId(rule,unit,config,line) : null,
      auto_position: maneuverSpec.can_automove ? !!rule.autoMove : false,
      move_mode:moveMode,...extra,dist_min:min,dist_max:max
    },target};
}
/** Throw a readable error instead of issuing an altered or partially mapped strategy. */
export function buildOfficialArenaActions(config, unitId, selectedIndices) {
  const unit=config?.units?.find(x=>x.id===unitId);
  if (!unit) throw Error('共有対象のキャラクターが見つかりません。');
  if (!Array.isArray(selectedIndices) || !selectedIndices.length ||selectedIndices.length>ARENA_MAX_RULES ||
    new Set(selectedIndices).size !== selectedIndices.length ||
    selectedIndices.some(i=>!Number.isInteger(i)||i<0||i>=unit.rules.length))
    throw Error(`発行するAIを1～${ARENA_MAX_RULES}件選んでください。`);
  return selectedIndices.map(i=>encodeRule(unit.rules[i],unit,config,i+1));
}
