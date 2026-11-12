import {clone,freshCondition,freshRule,freshSkill,uid,BS_NAMES,METRICS,TARGET_SORTS,validateConfig} from './model.js';
import {displayedSkillName} from './skill-dedup.js';

const normalize=text=>String(text||'').replace(/\s+/g,'').trim();
const actionTable=[
 ['防御集中','focusDefense'],['攻撃集中','focusAttack'],['行動値持ち越し','carry'],
 ['効果的なBS回復スキル','healBS'],['効果的なHP回復スキル','healHP'],
 ['効果的なAP回復スキル','healAP'],['効果的な攻撃','effectiveAttack'],
 ['通常攻撃','attack'],['ブロック','block'],['待機','wait'],['移動','move']
];
const subjects=[['敵味方','all'],['同行者','companions'],['自陣営','allies'],['条件該当者','previous'],['自身','self'],['敵','enemies']];
const labels=Object.entries(METRICS).sort((a,b)=>b[1][0].length-a[1][0].length);
const body=(parent,kind)=>{
 const item=[...parent.querySelectorAll('.arena-setting-action-list-item-detail-item')].find(el=>el.querySelector('.arena-setting-action-list-item-detail-item-heading')?.classList.contains(kind));
 return item?.querySelector('.arena-setting-action-list-item-detail-item-body')||null;
};
function parseCondition(text,warnings,context){
 const t=normalize(text);
 if(!t)return null;
 if(t.startsWith('確率')){
  const n=Number(t.match(/確率(\d+)/)?.[1]);
  if(Number.isFinite(n)&&n>=0&&n<=100)return {...freshCondition(),type:'chance',chance:n};
 }
 const subject=subjects.find(([j])=>t.startsWith(j))?.[1];
 const entry=labels.find(([,v])=>t.includes(v[0]));
 if(!subject||!entry){warnings.push(`${context}: 変換できない条件「${t.slice(0,95)}」`);return null;}
 const [metric,def]=entry;
 const selected=[...t.matchAll(/「([^」]+)」/g)].map(m=>m[1]);
 const bs=selected.filter(x=>BS_NAMES.includes(x));
 if(selected.some(x=>!BS_NAMES.includes(x)))warnings.push(`${context}: Battle LabにないBS名は条件から除外しました：${selected.filter(x=>!BS_NAMES.includes(x)).join('、')}`);
 const range=(t.replace(/「[^」]+」/g,'').match(/(\d+)(?:[～〜~－-](\d+))?(?=％|%|個|回|である時|$)/)||[]);
 if(def[2]!=='bool'&&!range.length){warnings.push(`${context}: 条件の数値が読み取れません（${t.slice(0,100)}）`);return null;}
 return {...freshCondition(),subject,metric,bs,min:range.length?Number(range[1]):0,max:range.length?Number(range[2]||range[1]):100,not:t.includes('でない時')};
}
function parseAction(text){
 const t=normalize(text);
 if(t.startsWith('指定アクティブスキル')){
  const m=t.match(/^指定アクティブスキル(.+?)（消費行動値/);
  return {action:'skill',skillName:m?.[1]||''};
 }
 return {action:actionTable.find(([j])=>t.startsWith(j))?.[1]||null,skillName:''};
}
function parseTarget(text){
 const t=normalize(text);
 const subject=subjects.find(([j])=>t.startsWith(j))?.[1]||'enemies';
 // Exact priority labels from the official target picker, including newly
 // supported high/low stat orders, take precedence over older heuristics.
 const exact=Object.entries(TARGET_SORTS).filter(([key])=>!['random','main'].includes(key))
  .sort((a,b)=>b[1].length-a[1].length).find(([,label])=>t.includes(normalize(label)));
 const sort=exact?.[0]||(t.includes('HP割合が最も')?'hpPct':t.includes('AP割合が最も')?'apPct':t.includes('HPが最も')?'hp':t.includes('APが最も')?'ap':t.includes('遠い')?'farthest':'nearest');
 const m=t.match(/で(?:HP|AP)割合が(\d+)[～〜~－-](\d+)％である者/);
 const subjectForFilter=subject==='previous'?'allies':subject;
 return {subject,sort,additional:m?{...freshCondition(),subject:subjectForFilter,metric:t.includes('HP割合')?'hpPct':'apPct',min:Number(m[1]),max:Number(m[2])}:null};
}
function parseRow(element,order,warnings,source){
 const area=`${source} ${order+1}行目`;
 const conditionBody=body(element,'condition'),actionBody=body(element,'maneuver'),targetBody=body(element,'target');
 const ruleConditions=[];let invalid=false;
 for(const el of conditionBody?.querySelectorAll(':scope > .arena-setting-action-list-item-detail-item-body-content')||[]){
  const condition=parseCondition(el.textContent,warnings,area);
  if(condition)ruleConditions.push(condition);else invalid=true;
 }
 const actionText=normalize(actionBody?.textContent);
 const {action,skillName}=parseAction(actionText);
 if(!action){warnings.push(`${area}: 対応していない行動「${actionText.slice(0,90)}」のため無効で取り込みます。`);invalid=true;}
 const targetInfo=parseTarget(targetBody?.textContent||'');
 if(targetInfo.additional)ruleConditions.push(targetInfo.additional);
 // The official target picker can constrain a target set by HP/AP ratio.
 // Battle Lab's 'previous' target must reference the matching condition, not
 // the unrestricted team pool, or the constraint would be silently lost.
 if(targetInfo.additional)targetInfo.subject='previous';
 // Self-only guard checks and ally candidate checks are an AND. Put the
 // self-only check first so the final 'previous' target is the ally candidate.
 if(targetInfo.subject==='previous'&&!targetInfo.additional&&ruleConditions.length>1){
  const selfChecks=ruleConditions.filter(c=>c.type==='who'&&c.subject==='self');
  if(selfChecks.length&&ruleConditions.some(c=>c.type==='who'&&c.subject!=='self')){
   const other=ruleConditions.filter(c=>!(c.type==='who'&&c.subject==='self'));
   ruleConditions.splice(0,ruleConditions.length,...selfChecks,...other);
  }
 }
 const r=freshRule({
  enabled:!invalid&&!(element.querySelector('.toggle-switch-input')&&!element.querySelector('.toggle-switch-input')?.checked),
  conditions:ruleConditions,
  action:action||'carry',skillId:'',target:targetInfo.subject,sort:targetInfo.sort,
  autoMove:actionText.includes('自動位置取り')&&!actionText.includes('自動位置取りしない'),
  moveMode:'fixed',minDist:0,maxDist:30
 });
 if(action==='skill'){r.arenaSkillName=skillName;if(!skillName){warnings.push(`${area}: スキル名が読み取れません。`);r.enabled=false;}}
 if(!actionText.includes('自動位置取り')&&['focusAttack','focusDefense','carry','wait'].includes(r.action))r.autoMove=false;
 return r;
}
/** Parse a saved arena page as inert markup. No page script is executed. */
export function parseArenaHtml(html){
 if(typeof html!=='string'||html.length>3_000_000)throw Error('HTMLファイルは3MB以下にしてください。');
 if(typeof DOMParser==='undefined')throw Error('HTML解析にはブラウザが必要です。');
 // Saved official pages may include external images, scripts and styles. Strip
 // resource-bearing elements before parsing, so import never runs scripts or
 // makes an outbound request for media/assets.
 const inertHtml=html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'')
  .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi,'')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'')
  .replace(/<(?:img|link|source|video|audio)\b[^>]*\/?>/gi,'');
 const doc=new DOMParser().parseFromString(inertHtml,'text/html');
 const editor=doc.querySelector('.arena-setting-action-editor');
 const saved=doc.querySelector('.arena-current-settings-setting');
 const root=editor?.querySelector('.arena-setting-action-list')?.querySelector('.arena-setting-action-list-item')?editor:saved;
 if(!root)throw Error('Lost Arcadiaアリーナの「行動設定」が見つかりません。');
 // Explicit cutoff: no action row appearing at/after the official fallback
 // notice may be referenced, even if its surrounding HTML structure changes.
 const fallbackBoundary=[...root.querySelectorAll('*')].find(el=>!el.children.length&&
   (el.textContent||'').includes('上記のどの条件も満たさない場合'));
 const rows=[...root.querySelectorAll('.arena-setting-action-list > .arena-setting-action-list-item')]
   .filter(el=>!fallbackBoundary||Boolean(el.compareDocumentPosition(fallbackBoundary)&Node.DOCUMENT_POSITION_FOLLOWING));
 if(!rows.length)throw Error('読み込める戦法ルールがありません。');
 const warnings=[];
 const source=root===editor?'編集画面':'現在保存済みの行動設定';
 const rules=rows.map((el,i)=>parseRow(el,i,warnings,source));
 // Official page: “※ 上記のどの条件も満たさない場合 ...” and everything
 // below it belongs to fallback behavior, NOT to the editable priority list.
 // Deliberately ignore its entire subtree, including the fallback actions.
 return {source,rules,warnings,primaryCount:rows.length,fallbackCount:0};
}

/** Convert imported arena tactics for one unit; do not invent unknown skill stats. */
export function importArenaTactics(config,unitId,parsed){
 if(!parsed||!Array.isArray(parsed.rules)||!parsed.rules.length||parsed.rules.length>200)throw Error('戦法設定の件数が不正です。');
 const next=clone(config),target=next.units.find(u=>u.id===unitId);
 if(!target)throw Error('読込先のキャラクターが見つかりません。');
 const warnings=[...(parsed.warnings||[])],unresolved=[];
 const getSkill=name=>{
  const matches=next.skills.filter(s=>normalize(s.name)===normalize(name)||(target.skills.includes(s.id)&&normalize(displayedSkillName(target,s))===normalize(name)));
  if(!matches.length||matches.every(s=>s.requiresReview)){
   // Arena HTML contains the *name* of an action but not the full skill
   // effects. Prepare an editable Accel Kaleido draft, never invent power,
   // AP cost or effects, and keep the associated rule disabled.
   let placeholder=next.skills.find(s=>s.requiresReview&&normalize(s.name)===normalize(name));
   if(!placeholder){
    placeholder=freshSkill({id:uid('acc'),name,kind:'attack',ap:0,cost:1,
     mainPct:0,mainBonus:0,subPct:0,subBonus:0,hitBonus:0,power:0,effects:{},bs:[],
     requiresReview:true,note:'公式アリーナHTMLでは名前しか取得できません。アクセルカレイドで射程・消費AP・威力・特殊効果などを設定し、保存後にAIルールを有効化してください。'});
    next.skills.push(placeholder);
   }
   warnings.push(`「${name}」は詳細を取得できないため、未設定のアクセルカレイドとして作成しました。性能を編集して保存するまではAIルールが無効です。`);
   return {skill:null,reason:'needs-configuration'};
  }
  const exactAlias=matches.filter(s=>target.skills.includes(s.id)&&normalize(target.skillAliases?.[s.id])===normalize(name));
  if(exactAlias.length===1)return {skill:exactAlias[0],reason:null};
  if(matches.length===1)return {skill:matches[0],reason:null};
  // The character import keeps its copied active skills alongside the 220
  // read-only WIKI skills. These share names but have different ids/effects.
  // Prefer the skill already equipped by *this* character, not another
  // character's imported skill or an unrelated custom skill of the same name.
  const equipped=matches.filter(s=>target.skills.includes(s.id));
  const unique=xs=>xs.length===1?xs[0]:null;
  const imported=equipped.filter(s=>s.source==='公開キャラクターページ');
  const official=matches.filter(s=>/^wiki-\d+$/.test(s.id));
  const chosen=unique(equipped)||unique(imported)||unique(equipped.filter(s=>official.includes(s)))||
   (!equipped.length?unique(official):null);
  if(chosen){
   warnings.push(`「${name}」は同名スキルが${matches.length}件あります。${target.skills.includes(chosen.id)?'このキャラの装備済み':'公式WIKI収録'}「${chosen.id}」を優先しました。`);
   return {skill:chosen,reason:null};
  }
  warnings.push(`「${name}」は同名スキルが${matches.length}件あり、対象キャラの装備から1件に絞れません。手動選択してください。`);
  return {skill:null,reason:'ambiguous'};
 };
 const memo=new Map();
 target.rules=parsed.rules.map((source,i)=>{
  const r=clone(source);r.id=`arena-${Date.now().toString(36)}-${i+1}`;
  if(r.action==='skill'){
   const name=r.arenaSkillName||'';
   if(!memo.has(name))memo.set(name,name?getSkill(name):{skill:null,reason:'not-found'});
   const lookup=memo.get(name),skill=lookup.skill;
   if(skill){r.skillId=skill.id;if(!target.skills.includes(skill.id))target.skills.push(skill.id);
    // The source says 「適切な距離」 without a number. Use this skill's upper range.
    const max={touch:3,near:10,mid:20,far:30,super:40,special:skill.customRange||20}[skill.range]||20;
    r.minDist=0;r.maxDist=max;
   }else{r.skillId='';r.enabled=false;unresolved.push({rule:i+1,name,reason:lookup.reason});}
  }
  return r;
 });
 // Validate without changing the original config on errors.
 const failures=validateConfig(next);
 if(failures.length)throw Error(`読込後の設定が不正です：${failures.join(' / ')}`);
 warnings.push('「対象から適切な距離に」は使用スキルの射程に合わせた近似値へ変換します。公式の位置取りと完全には一致しません。');
 return {config:next,ruleCount:target.rules.length,skillCount:target.skills.length,matchedSkillCount:target.rules.filter(r=>r.action==='skill'&&r.enabled).length,unresolved,warnings,source:parsed.source,primaryCount:parsed.primaryCount,fallbackCount:parsed.fallbackCount};
}
