import {CATALOG} from './catalog.js';
import {clone,uid} from './model.js';

// WIKI originals are protected. The nine historical demo skills are removed on migration.
const WIKI_IDS = new Set(CATALOG.map(skill => skill.id));
const LEGACY_DEMO_MAP = new Map([
 ['strike','wiki-001'],['flame','wiki-041'],['heal','wiki-212'],
 ['charge','wiki-202'],['cleanse',null],['guard',null],
 ['arrow','wiki-018'],['counter',null],['passive',null]
]);
const BUILTIN_IDS = WIKI_IDS;

/** Remove old demo entries, retain user-created skills, and repair equipment/AI references. */
export function migrateLegacyDemoSkills(config) {
 if (!config || !Array.isArray(config.skills) || !Array.isArray(config.units)) return config;
 const existing = new Set(config.skills.map(skill=>skill.id));
 config.skills = config.skills.filter(skill=>!LEGACY_DEMO_MAP.has(skill.id));
 // Imported/older configs may contain only a subset of the official WIKI catalog.
 for (const skill of CATALOG) if (!existing.has(skill.id)) config.skills.push(clone(skill));
 for (const unit of config.units) {
  if (Array.isArray(unit.skills)) {
   unit.skills=[...new Set(unit.skills.map(id=>LEGACY_DEMO_MAP.has(id)?LEGACY_DEMO_MAP.get(id):id).filter(Boolean))];
  }
  for (const rule of unit.rules||[]) {
   if (rule.action==='skill' && LEGACY_DEMO_MAP.has(rule.skillId)) {
    const replacement=LEGACY_DEMO_MAP.get(rule.skillId);
    if (replacement && unit.skills.includes(replacement)) rule.skillId=replacement;
    else {rule.action='attack';rule.skillId='';rule.target='enemies';}
   }
  }
 }
 return config;
}

export const isProtectedSkill = skill => Boolean(skill && (BUILTIN_IDS.has(skill.id) || skill.source));
export const isReadOnlySkill = skill => Boolean(skill && (WIKI_IDS.has(skill.id) || skill.source));
export const isCustomSkill = skill => Boolean(skill && !isProtectedSkill(skill));

export function copyAsCustom(skill) {
  if (!skill) throw Error('複製元のスキルが見つかりません。');
  const result = clone(skill);
  result.id = uid('acc');
  result.name += '（調整）';
  if (result.original) result.originalSource = result.original;
  delete result.source;
  return result;
}

export function saveSkillDraft(config, draft, unitId, equip = true) {
  if (!draft || !draft.id) throw Error('スキルIDを確認してください。');
  const existingIndex = config.skills.findIndex(skill => skill.id === draft.id);
  const existing = config.skills[existingIndex];
  // Official WIKI skills are read-only and cannot be deleted.
  if (isReadOnlySkill(existing) || (existingIndex < 0 && BUILTIN_IDS.has(draft.id))) {
    throw Error('既存の公式スキルは変更できません。複製して編集してください。');
  }
  const saved = clone(draft);
  if (existingIndex >= 0) config.skills[existingIndex] = saved;
  else config.skills.push(saved);
  if (equip) {
    const unit = config.units.find(unit => unit.id === unitId);
    if (!unit) throw Error('装備先のユニットが見つかりません。');
    if (!unit.skills.includes(saved.id)) unit.skills.push(saved.id);
  }
  return saved;
}

export function deleteCustomSkill(config, skillId) {
  const skill = config.skills.find(skill => skill.id === skillId);
  if (!skill) return {ok:false, reason:'スキルが見つかりません。'};
  if (isProtectedSkill(skill)) return {ok:false, reason:'既存スキルは削除できません。'};
  let changedRules = 0;
  for (const unit of config.units) {
    unit.skills = unit.skills.filter(id => id !== skillId);
    for (const rule of unit.rules) {
      if (rule.action === 'skill' && rule.skillId === skillId) {
        rule.action = 'attack';
        rule.skillId = '';
        rule.target = 'enemies';
        changedRules++;
      }
    }
  }
  config.skills = config.skills.filter(item => item.id !== skillId);
  return {ok:true, changedRules};
}
