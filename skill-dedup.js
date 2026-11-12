/**
 * Combat-equivalent active skills share a global skill ID even when the public
 * character page uses a specialized display name. Names are unit-scoped, not
 * identifiers. Keep all modeled combat modifiers in the signature to avoid
 * conflating skills that merely look similar.
 */
const GAMEPLAY_FIELDS = [
 'kind','ap','cost','range','scope','customRange','radius',
 'mainPct','mainBonus','subPct','subBonus','hitBonus','power',
 'bs','bsTurns','buffTurns','modifiers','effects','castMods',
 'grantedEffects','selfModifiers','selfEffects','elements',
 'elementCorrection','trigger','passiveWhen','interval'
];
const normalizeName=name=>String(name||'').normalize('NFKC').replace(/\s+/g,'').trim();
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function skillGameplayKey(skill){
 if(!skill||!normalizeName(skill.name))return null;
 const data={};
 for(const key of GAMEPLAY_FIELDS)if(skill[key]!==undefined)data[key]=skill[key];
 return JSON.stringify(canonical(data));
}
export function sameGameplaySkill(a,b){
 const key=skillGameplayKey(a);
 return key!==null&&key===skillGameplayKey(b);
}
export const isWikiSkill=skill=>/^wiki-\d{3}$/.test(skill?.id||'');
export const isCharacterImportedSkill=skill=>skill?.source==='公開キャラクターページ'||!!skill?.importedFromCharacter;
export const displayedSkillName=(unit,skill)=>unit?.skillAliases?.[skill?.id]||skill?.name||'';
/** Prefer a documented base skill, then matching public name, then WIKI ID. */
export function findReusableImportedSkill(existingSkills,incoming){
 if(incoming?.requiresReview)return null;
 const candidates=existingSkills.filter(s=>!s.requiresReview&&(isWikiSkill(s)||isCharacterImportedSkill(s))&&sameGameplaySkill(s,incoming));
 candidates.sort((a,b)=>{
  const rank=s=>Number(normalizeName(s.name)===normalizeName(incoming.baseName))*8+
   Number(normalizeName(s.name)===normalizeName(incoming.name))*4+
   Number(isWikiSkill(s))*2;
  return rank(b)-rank(a) || String(a.id).localeCompare(String(b.id));
 });
 return candidates[0]||null;
}
/**
 * Remove old character-page duplicates, keep aliases per unit, and turn
 * unmatched older imports into editable Accel Kaleido skills. User-made
 * custom skills never participate in automatic cleanup.
 */
export function deduplicateImportedSkills(config){
 if(!config||!Array.isArray(config.skills)||!Array.isArray(config.units))return {config,removed:0,converted:0};
 const replacements=new Map(),kept=[];
 const originals=config.skills.filter(s=>!isCharacterImportedSkill(s));
 const imports=config.skills.filter(isCharacterImportedSkill);
 let converted=0;
 for(const skill of imports){
  const existing=skill.requiresReview?null:findReusableImportedSkill([...originals,...kept],skill);
  if(existing&&existing.id!==skill.id)replacements.set(skill.id,{id:existing.id,name:skill.name,canonicalName:existing.name});
  else{
   if(skill.source==='公開キャラクターページ'){
    delete skill.source;
    skill.importedFromCharacter??={originalId:skill.originSkillId||null};
    converted++;
   }
   kept.push(skill);
  }
 }
 if(replacements.size){
  config.skills=config.skills.filter(s=>!replacements.has(s.id));
  for(const unit of config.units){
   const aliases={...(unit.skillAliases||{})};
   for(const oldId of unit.skills||[]){
    const replacement=replacements.get(oldId);
    if(!replacement)continue;
    const alias=aliases[oldId]||replacement.name;
    if(alias&&alias!==replacement.canonicalName)aliases[replacement.id]=alias;
    delete aliases[oldId];
   }
   if(Array.isArray(unit.skills))unit.skills=[...new Set(unit.skills.map(id=>replacements.get(id)?.id||id))];
   for(const rule of unit.rules||[])if(rule?.action==='skill'&&replacements.has(rule.skillId))rule.skillId=replacements.get(rule.skillId).id;
   unit.skillAliases=aliases;
  }
 }
 return {config,removed:replacements.size,converted};
}
