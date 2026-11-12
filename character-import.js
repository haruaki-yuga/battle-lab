import {STAT_LABELS,EFFECTS,BS_NAMES,freshSkill,freshUnit,freshRule,clone,uid} from './model.js';
import {findReusableImportedSkill} from './skill-dedup.js';

const statNames={HP:'maxHp',AP:'maxAp',...Object.fromEntries(Object.entries(STAT_LABELS).map(([k,v])=>[v,k])),主攻:'main',副攻:'sub',回復:'heal',防技:'defense',抵抗:'resist',機動:'mobility',CT:'critical',FB:'fumble'};
const effectNames=Object.fromEntries(Object.entries(EFFECTS).map(([k,v])=>[v,k]));
const rangeNames={至:'touch',近:'near',中:'mid',遠:'far',超:'super',特レ:'special',自:'touch'};
const scopeNames={単:'single',範:'area',域:'wide',貫:'pierce',扇:'cone',列:'line',ラ:'random',特:'special'};

// Only visible text is used. Never render or evaluate upstream HTML.
export function visibleText(value){
 return String(value??'').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>{if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[e.toLowerCase()];}).trim();
}
export function parseCharacterURL(value){
 let u;try{u=new URL(String(value).trim());}catch{throw Error('キャラクター詳細ページのURLを入力してください。');}
 const m=u.pathname.match(/^\/character\/detail\/(r2p\d{6})\/?$/);
 if(u.protocol!=='https:'||u.hostname!=='rev2.reversion.jp'||u.port||u.username||u.password||!m)throw Error('https://rev2.reversion.jp/character/detail/r2p000035 の形式で入力してください。');
 return {id:m[1],url:`https://rev2.reversion.jp/character/detail/${m[1]}`};
}
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9;

export function parseActiveSkill(raw,index=0){
 const original=visibleText(raw?.display_effects),issues=[];
 const name=visibleText(raw?.name)||`名称未取得 ${index+1}`;
 const s=freshSkill({id:`source-${index}`,name,mainBonus:0,subBonus:0,hitBonus:0,power:0,effects:{},castMods:{},grantedEffects:{},selfModifiers:{},selfEffects:{},elements:{},elementCorrection:0,original,note:visibleText(raw?.description),source:'公開キャラクターページ',originSkillId:String(raw?.id??index),baseName:visibleText(raw?.specialization_base?.name),unmodeled:[]});
 const active=raw?.active;
 if(!active||!finite(active.ap_cost)||active.ap_cost<0||!finite(active.ticks)||active.ticks<0)issues.push('消費AP・行動値を取得できません');
 else{s.ap=active.ap_cost;s.cost=active.ticks;}
 const normalized=original.normalize('NFKC').replace(/\s+/g,'');
 const prefix=normalized.match(/^(?:【効果】)?(特レ|至|近|中|遠|超|自)(単|範|域|貫|扇|列|ラ|特)?[:：]/);
 if(!prefix)issues.push('射程・効果範囲を解析できません');
 else{s.range=rangeNames[prefix[1]];s.scope=prefix[1]==='自'?({単:'self',範:'selfArea',域:'selfWide'}[prefix[2]]||'self'):(scopeNames[prefix[2]]||'special');}
 const tags=[...normalized.matchAll(/【(.*?)】/g)].map(m=>m[1]);
 const base=normalized.replace(prefix?.[0]||/^$/,'').replace(/【.*?】/g,'');
 for(const token of base.split(/[、,]/).filter(Boolean)){
  let m=token.match(/^(主攻|副攻|命中|CT|FB)([+-]?\d+(?:\.\d+)?)$/);
  if(m){if(['CT','FB'].includes(m[1]))s.castMods[statNames[m[1]]]=Number(m[2]);else s[{主攻:'mainBonus',副攻:'subBonus',命中:'hitBonus'}[m[1]]]=Number(m[2]);continue;}
  m=token.match(/^(HP|AP|HA)回復力(÷2)?([+-]\d+(?:\.\d+)?)?$/);
  if(m){s.kind={HP:'hp',AP:'ap',HA:'ha'}[m[1]];s.power=Number(m[3]||0);if(m[2]&&m[1]!=='HA')issues.push(token);continue;}
  m=token.match(/^(火|水|土|風|光|闇|無)([+-]\d+)$/);if(m){s.elements[m[1]]=Number(m[2]);continue;}
  issues.push(token);
 }
 for(let tag of tags){
  if(['効果','治癒'].includes(tag)||tag.startsWith('シナリオ時')||tag.startsWith('装制'))continue;
  if(['HP回復','AP回復','HA回復'].includes(tag)){s.kind={HP回復:'hp',AP回復:'ap',HA回復:'ha'}[tag];continue;}
  if(tag==='迎撃'||tag==='報復'){s.trigger=tag==='迎撃'?'intercept':'retaliate';continue;}
  let mode='cast';if(tag.startsWith('付:')){mode='grant';tag=tag.slice(2);}else if(tag.startsWith('自:')){mode='self';tag=tag.slice(2);}
  const m=tag.match(/^(.+?)([+-]?\d+(?:\.\d+)?)$/);
  if(mode!=='cast'&&m&&statNames[m[1]]){s[mode==='grant'?'modifiers':'selfModifiers'][statNames[m[1]]]=Number(m[2]);continue;}
  if(mode==='cast'&&BS_NAMES.includes(tag)){s.bs.push(tag);continue;}
  const key=effectNames[tag]||effectNames[m?.[1]];
  if(key){s[{cast:'effects',grant:'grantedEffects',self:'selfEffects'}[mode]][key]=effectNames[tag]?1:Number(m[2]);continue;}
  issues.push(tag);
 }
 if(tags.includes('治癒')&&s.kind==='attack')s.kind='cleanse';
 if(s.kind==='attack'&&(Object.keys(s.modifiers).length||Object.keys(s.selfModifiers).length||Object.keys(s.grantedEffects).length||Object.keys(s.selfEffects).length)&&!/主攻|命中/.test(base))s.kind='buff';
 if(s.kind==='buff'&&prefix?.[1]==='自'){Object.assign(s.modifiers,s.selfModifiers);Object.assign(s.grantedEffects,s.selfEffects);s.selfModifiers={};s.selfEffects={};}
 if(prefix?.[1]==='特レ'){issues.push('特殊射程・対象人数は手動設定が必要です');}
 if(s.cost+(s.effects.chargeTime||0)<1)issues.push('行動値と溜が両方0です');
 // An unfamiliar category must not silently become an attack.
 if(active?.category&&!['ATTACK','HEAL','SUPPORT','BUFF'].includes(active.category))issues.push(`未対応の分類 ${active.category}`);
 s.unmodeled=[...new Set(issues)];
 return {name,original,baseName:s.baseName,originSkillId:s.originSkillId,issues:s.unmodeled,supported:issues.length===0,skill:s};
}

export function parseCharacterData(data,sourceURL,at=new Date().toISOString()){
 const {id,url}=parseCharacterURL(sourceURL),c=data?.data?.character;
 if(data?.errors?.length)throw Error('公開データの取得に失敗しました。時間をおいて再度お試しください。');
 if(!c||c.character_id!==id)throw Error('キャラクターが見つからないか、公開されていません。');
 if(!Array.isArray(c.sub_status))throw Error('能力値が公開されていません。');
 const stats={},effects={},immunities=[],warnings=[],otherStats=[];
 for(const row of c.sub_status){
  const name=visibleText(row.name),abbr=visibleText(row.abbr),key=statNames[name]||statNames[abbr];
  if(key){if(finite(row.value))stats[key]=row.value;continue;}
  const effect=effectNames[name]||effectNames[abbr];
  if(effect&&finite(row.value)){effects[effect]=row.value;continue;}
  if(row.type==='ELEMENT'||name==='活性限界値'){otherStats.push({name,value:row.value});continue;}
  // Retain unsupported passive/conditional effects for review rather than guessing.
  if(row.value)warnings.push(`常時効果「${name} ${row.value}」は自動反映に未対応です。`);
 }
 const missing=Object.keys(STAT_LABELS).filter(k=>!finite(stats[k]));
 if(missing.length)warnings.push(`未取得の能力値：${missing.map(k=>STAT_LABELS[k]).join('、')}`);
 const rawSkills=c.skills;
 if(!rawSkills||!Array.isArray(rawSkills.a)||!Array.isArray(rawSkills.ex_a))throw Error('装備スキルが公開されていません。');
 const seen=new Set(),skills=[];
 for(const r of [...rawSkills.a,...rawSkills.ex_a]){if(seen.has(String(r.id)))continue;seen.add(String(r.id));skills.push(parseActiveSkill(r,skills.length));}
 const references=[['常時補正',rawSkills.p],['クラス',c.classes],['エスプリ',c.esprits]].flatMap(([category,list])=>(list||[]).map(r=>({category,name:visibleText(r.name),original:visibleText(r.display_effects)})));
 const unsupported=skills.filter(s=>!s.supported);
 if(unsupported.length)warnings.push(`${unsupported.length}件のスキルは未対応の効果があるため、自動セットされません。効果文を確認し、カスタムスキルで設定してください。`);
 if(stats.maxHp<1||stats.maxAp<0||stats.mobility<0)throw Error('HP・AP・機動力がシミュレーターの入力範囲外です。');
 return {characterId:id,sourceURL:url,fetchedAt:at,name:visibleText(c.name),level:c.level,stats,effects,immunities,skills,references,otherStats,missing,warnings};
}

export function createImportedUnit(profile,{team='A',normalRange='near',replace=null,count=0,existingSkills=[]}={}){
 if(profile.missing.length)throw Error('必要な能力値を取得できなかったため、取り込みを中止しました。');
 const skills=[],equipment=[],skillAliases={};let reused=0;
 for(const entry of profile.skills.filter(r=>r.supported)){
  const existing=findReusableImportedSkill([...existingSkills,...skills],entry.skill);
  if(existing){
   equipment.push(existing.id);reused++;
   if(entry.name!==existing.name)skillAliases[existing.id]=entry.name;
  }else{
   // No matching WIKI/public skill: treat it as an editable Accel Kaleido.
   const created={...clone(entry.skill),id:uid('acc')};
   delete created.source;
   created.importedFromCharacter={characterId:profile.characterId,skillId:entry.originSkillId||null,url:profile.sourceURL};
   skills.push(created);equipment.push(created.id);
  }
 }
 // A partially parsed skill cannot be simulated safely. Preserve it as a
 // non-equipped, editable Accel draft instead of dropping it or guessing data.
 let drafts=0;
 for(const entry of profile.skills.filter(r=>!r.supported)){
  const matches=[...existingSkills,...skills];
  const found=matches.find(s=>s.requiresReview&&s.importedFromCharacter?.characterId===profile.characterId&&s.importedFromCharacter?.skillId===entry.originSkillId&&s.name===entry.name);
  if(found)continue;
  const created={...clone(entry.skill),id:uid('acc'),requiresReview:true};
  delete created.source;
  created.importedFromCharacter={characterId:profile.characterId,skillId:entry.originSkillId||null,url:profile.sourceURL};
  created.note=`公開スキルの解析未完了：${entry.issues.join('、')}。効果文と数値を確認し、アクセルカレイドで編集・保存してから装備してください。\n${created.note||''}`;
  skills.push(created);drafts++;
 }
 const u=freshUnit({id:replace?.id||uid('u'),name:profile.name,team,...profile.stats,normalRange,x:replace?.x??(team==='A'?-10:10),y:replace?.y??0,skills:[...new Set(equipment)],skillAliases,effects:clone(profile.effects),immunities:clone(profile.immunities),rules:[freshRule({action:'effectiveAttack',moveMode:'approach'}),freshRule({conditions:[],action:'carry',autoMove:false,target:'self'})],importedProfile:{characterId:profile.characterId,url:profile.sourceURL,fetchedAt:profile.fetchedAt,references:clone(profile.references),otherStats:clone(profile.otherStats),warnings:clone(profile.warnings),unsupported:profile.skills.filter(r=>!r.supported).map(({name,original,issues})=>({name,original,issues}))}});
 return {unit:u,skills,reused,renamed:Object.keys(skillAliases).length,drafts};
}
