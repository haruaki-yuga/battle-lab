// Local battle-only dialogue. Never consumes the engine's RNG or changes battle outcomes.
// Character settings contain only the text; trigger chances remain fixed game rules.
const def = (key, label, chance, group) => Object.freeze({ key, label, chance, group });
const entries = [
  def('start','試合開始前（挨拶）',100,'試合開始・終了'),
  def('victory','試合終了後（勝利時）',100,'試合開始・終了'),
  def('draw','試合終了後（引き分け時）',100,'試合開始・終了'),
  def('defeat','試合終了後（敗北時）',100,'試合開始・終了'),
  def('attack','攻撃時',30,'行動・判定'),
  def('heal','治癒時',30,'行動・判定'),
  def('buff','付与時',30,'行動・判定'),
  def('critical','クリティカル時',50,'行動・判定'),
  def('fumble','ファンブル時',30,'行動・判定'),
  def('dodge','攻撃回避時',20,'行動・判定'),
  def('criticalDodge','クリティカル回避時',30,'行動・判定'),
  ...[10,20,30,50,75].flatMap((pct,i) => [
    def(`damage${pct}A`,`最大HPの${pct}%以上のダメージを受けた時 A`,[20,30,50,100,100][i],'被ダメージ A・B'),
    def(`damage${pct}B`,`最大HPの${pct}%以上のダメージを受けた時 B`,[20,30,50,100,100][i],'被ダメージ A・B')
  ]),
  def('selfHeal','自己を回復した時',30,'回復・付与・かばう'),
  def('receivedHeal','誰かに回復された時',50,'回復・付与・かばう'),
  def('selfBuff','自己に付与した時',30,'回復・付与・かばう'),
  def('receivedBuff','誰かに付与された時',50,'回復・付与・かばう'),
  def('cover','誰かをかばった時',50,'回復・付与・かばう'),
  def('covered','誰かにかばわれた時',50,'回復・付与・かばう'),
  def('drama','ドラマ復活に成功した時',100,'戦闘不能・決着'),
  def('ko','KOされた時',100,'戦闘不能・決着'),
  def('lastKo','最後にKOされた時（優先）',100,'戦闘不能・決着'),
  def('knockout','攻撃で相手をKOした時',100,'戦闘不能・決着'),
  def('finalKnockout','攻撃で最後の相手をKOした時',100,'戦闘不能・決着')
];
export const REACTION_DEFINITIONS = Object.freeze(entries);
const REACTION_CACHE=new WeakMap();
const DEFINITIONS = new Map(entries.map(item => [item.key,item]));
export function validReactionLines(lines) {
  return lines === undefined || (!!lines && typeof lines==='object' && !Array.isArray(lines) &&
    Object.entries(lines).length<=REACTION_DEFINITIONS.length &&
    Object.entries(lines).every(([key,text])=> DEFINITIONS.has(key) && typeof text==='string' && text.length<=500));
}
export function normalizedReactionLines(lines) {
  if(!lines || typeof lines!=='object' || Array.isArray(lines))return {};
  return Object.fromEntries(Object.entries(lines).filter(([key,text])=>DEFINITIONS.has(key) && typeof text==='string' && text.trim())
    .map(([key,text])=>[key,text.slice(0,500)]));
}
// A stable uniform draw, independent of the Battle engine's random generator.
function draw(seed,unitId,logId,key,salt='') {
  const str=`${seed}|${unitId}|${logId}|${key}|${salt}`;
  let h=2166136261;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;
  return (h>>>0)/4294967296;
}
function frameUnit(battle,index,id){return battle.frames?.[index]?.units?.find(u=>u.id===id);}
function priorFrameUnit(battle,index,id){for(let i=index-1;i>=0;i--){const u=frameUnit(battle,i,id);if(u)return u;}return null;}
function recordedDamage(battle,log,targetId=log.target) {
  if(!targetId || log.frameIndex==null || log.frameIndex<1 || !['damage','pursuit','bs','suddenDamage'].includes(log.type))return 0;
  const curr=frameUnit(battle,log.frameIndex,targetId),prev=priorFrameUnit(battle,log.frameIndex,targetId);
  // Only the actual loss of HP qualifies: barrier absorption and AP-only loss do not.
  if(!curr||!prev||!Number.isFinite(curr.maxHp)||curr.maxHp<=0)return 0;
  return Math.max(0,(prev.hp-curr.hp)/curr.maxHp*100);
}
function actionKind(battle,log) {
  if(log.type!=='skill'||!log.actor)return '';
  const unit=battle.config?.units?.find(u=>u.id===log.actor);
  if(!unit)return '';
  const name=String(log.message||'').slice((unit.name+'の').length);
  if(!String(log.message||'').startsWith(unit.name+'の'))return '';
  if(name==='通常攻撃')return 'attack';
  const skill=battle.config.skills.find(s=>s.name===name && (unit.skills||[]).includes(s.id));
  return skill?.kind==='attack'?'attack':skill?.kind==='buff'?'buff':skill&&['hp','ap','ha','cleanse'].includes(skill.kind)?'heal':'';
}
function directlyKnockedOut(battle,logs,index) {
  const log=logs[index];
  if(log?.type!=='down'||!log.actor||!log.target)return false;
  const prior=logs[index-1];
  return !!(prior && ['damage','pursuit'].includes(prior.type) && prior.actor===log.actor && prior.target===log.target && prior.turn===log.turn && prior.gauge===log.gauge && !/反射|反動|サドンデス/.test(prior.detail||''));
}
function finalTeamMemberDown(battle,log) {
  const down=frameUnit(battle,log.frameIndex,log.target);
  return !!(down && !battle.frames?.[log.frameIndex]?.units?.some(u=>u.team===down.team && u.alive));
}
function lastEnemyDown(battle,log){return finalTeamMemberDown(battle,log);}
/** Return one resolved reaction per log and unit.  Priority is guaranteed; damage thresholds are exclusive. */
export function buildBattleReactions(battle) {
  if(!battle?.config?.units || !Array.isArray(battle.logs))return [];
  const units=battle.config.units.filter(u=>Object.values(u.reactionLines||{}).some(v=>typeof v==='string'&&v.trim()) &&
    !(battle.config.challenge?.id==='serara-normal' && u.team==='B'));
  if(!units.length)return [];
  const cached=REACTION_CACHE.get(battle);
  if(cached && cached.count===battle.logs.length && cached.done===battle.done && cached.winner===battle.winner)return cached.events;
  const linesById=new Map(units.map(u=>[u.id,normalizedReactionLines(u.reactionLines)]));
  const events=[];
  const acted=new Set();
  function oncePerAction(u,key,log){
    if(!u)return;
    const token=`${u.id}|${key}|${log.turn}|${log.gauge}`;
    if(acted.has(token))return;
    acted.add(token);push(u,key,log);
  }
  function push(u,key,log,force=false){
    const text=linesById.get(u.id)?.[key],spec=DEFINITIONS.get(key);
    if(!text || !spec || (!force && draw(battle.seed||'',u.id,log?.id??-1,key)*100 >= spec.chance))return false;
    events.push({unitId:u.id,unitName:u.name,key,text,logId:log?.id??null,
      frameIndex:log?.frameIndex??0,turn:log?.turn??0});return true;
  }
  for(const u of units)push(u,'start',null);
  for(let i=0;i<battle.logs.length;i++){
    const log=battle.logs[i];
    // Resolve participants from the complete roster, not only dialogue-enabled
    // units. A silent healer or attacker must still trigger the recipient's line.
    const actor=battle.config.units.find(u=>u.id===log.actor);
    const target=battle.config.units.find(u=>u.id===(log.target || (log.type==='bs'?log.actor:null)));
    if(log.type==='down') {
      if(target){const last=finalTeamMemberDown(battle,log);push(target,last && linesById.get(target.id)?.lastKo?'lastKo':'ko',log);}
      if(actor && directlyKnockedOut(battle,battle.logs,i)){
        const key=lastEnemyDown(battle,log)?'finalKnockout':'knockout';
        // A character with only the ordinary KO line still speaks on a final KO.
        push(actor,linesById.get(actor.id)?.[key]?key:'knockout',log);
      }
      continue;
    }
    if(log.type==='drama'&&actor){push(actor,'drama',log);continue;}
    if(log.type==='result')continue;
    if(log.type==='action'&&/をかばう！/.test(log.message||'')){
      if(actor)push(actor,'cover',log);
      if(target)push(target,'covered',log);
      continue;
    }
    if(log.type==='miss'){
      if(/ファンブル/.test(log.message||'')){if(actor)push(actor,'fumble',log);}
      else if(/クリティカル回避/.test(log.message||'')){if(target)push(target,'criticalDodge',log);}
      else if(/回避/.test(log.message||'')){if(target)push(target,'dodge',log);}
      continue;
    }
    if(log.type==='skill'&&actor){const kind=actionKind(battle,log);if(kind==='attack')push(actor,'attack',log);if(log.castCritical)push(actor,'critical',log);continue;}
    if(log.type==='heal' && !actor && !target && /(?:再生でHP|充填でAP) \+[1-9]/.test(log.message||'')){
      const receiver=units.find(u=>log.message.startsWith(`${u.name}：`) &&
        (frameUnit(battle,log.frameIndex,u.id)?.hp>priorFrameUnit(battle,log.frameIndex,u.id)?.hp ||
         frameUnit(battle,log.frameIndex,u.id)?.ap>priorFrameUnit(battle,log.frameIndex,u.id)?.ap));
      if(receiver)push(receiver,'selfHeal',log);
      continue;
    }
    if(log.type==='heal'&&actor && target && /\+[1-9]/.test(log.message||'')){
      oncePerAction(actor,'heal',log);
      if(actor.id===target.id)push(target,'selfHeal',log);
      else push(target,'receivedHeal',log);
      continue;
    }
    if(log.type==='buff'&&actor&&target&&/の付与（/.test(log.message||'')){
      oncePerAction(actor,'buff',log);push(target,actor.id===target.id?'selfBuff':'receivedBuff',log);continue;
    }
    if(['damage','pursuit','bs','suddenDamage'].includes(log.type)){
      const pct=recordedDamage(battle,log,target?.id);
      if(target && pct>=10){
        const tier=[75,50,30,20,10].find(n=>pct>=n && (linesById.get(target.id)?.[`damage${n}A`] || linesById.get(target.id)?.[`damage${n}B`]));
        if(tier===undefined)continue;
        // Pick A/B evenly before the chance check. A missing side falls back to the configured side.
        const chooseB=draw(battle.seed||'',target.id,log.id,`damage${tier}`,'variant')>=.5;
        const preferred=`damage${tier}${chooseB?'B':'A'}`;
        const alternate=`damage${tier}${chooseB?'A':'B'}`;
        push(target,linesById.get(target.id)?.[preferred]?preferred:alternate,log);
      }
      if(log.type==='damage' && actor && /(?:^|\s|｜)CT \/ /.test(log.detail||''))push(actor,'critical',log);
    }
  }
  if(battle.done){
    const last=battle.logs.findLast(l=>l.type==='result')||battle.logs.at(-1)||null;
    for(const u of units)push(u,battle.winner==='draw'?'draw':battle.winner===u.team?'victory':'defeat',last,true);
  }
  REACTION_CACHE.set(battle,{count:battle.logs.length,done:battle.done,winner:battle.winner,events});
  return events;
}
export function battleReactionByLog(battle){const map=new Map();for(const e of buildBattleReactions(battle)){if(e.logId==null)continue;const a=map.get(e.logId)||[];a.push(e);map.set(e.logId,a);}return map;}
export function battleReactionAt(battle,frameIndex,selectedLogId=-1){
  const all=buildBattleReactions(battle);
  if(frameIndex===0&&selectedLogId===-1)return all.filter(e=>e.logId===null);
  return all.filter(e=>e.logId!==null && e.frameIndex<=frameIndex && (selectedLogId<0 || e.logId<=selectedLogId)).slice(-3);
}
