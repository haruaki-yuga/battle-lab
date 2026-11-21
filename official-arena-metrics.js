// Public Arena battle metrics reconstructed from ordered official events.
// StateLog.add_hp/add_ap are NOT reliable damage deltas: real official battles
// can report zero for every state even when HP/AP changed. Compare successive
// snapshots, then require a matching damage/heal event before attributing it.
const number = n => n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n);
const content = log => [log?.text, typeof log?.roll === 'string' ? log.roll :
    log?.roll == null ? '' : JSON.stringify(log.roll)].filter(Boolean).join(' ');
const HIT_NAMES = {グレイズ:'G',ライト:'L',クリーン:'C',ハード:'H',スマッシュ:'S'};
const FIELDS = ['damageGivenHP','damageGivenAP','damageTakenHP','damageTakenAP',
    'healGivenHP','healGivenAP','healReceivedHP','healReceivedAP','attacks','hitAttempts',
    'hitLanded','dodged','incomingAttempts','criticals','fumbles','bsInflicted','bsReceived',
    'defenseSuccess','defenseFailure','resistSuccess','resistFailure','covered','wasCovered',
    'drama','diceSum','diceCount','maxGivenHP','maxTakenHP','actions','defeats'];
const createRow = u => ({id:u.id,name:u.name,team:u.team,hitRanks:null,
    ...Object.fromEntries(FIELDS.map(key=>[key,null]))});
const add = (row,key,amount=1) => {if(row&&Number.isFinite(amount))row[key]=(row[key]??0)+amount;};
const setMax = (row,key,amount) => {if(row&&Number.isFinite(amount))row[key]=Math.max(row[key]??0,amount);};
const resultOf = str => /ファンブル|失敗[！!]?/.test(str) ? false : /成功[！!]?/.test(str) ? true : null;
const rankOf = str => Object.entries(HIT_NAMES).find(([name])=>str.includes(name+'ヒット'))?.[1]||null;
const aliases = unit => {
    const name=String(unit.name||'');
    // Official summaries often use given names, not the full team-entry name.
    return [...new Set([name,...name.split(/[\s　・･]+/).filter(p=>p.length>=2),name.split('・')[0]].filter(Boolean))];
};
function explicitTarget(message,members){
    const candidates=members.filter(u=>aliases(u).some(alias=>[
        `${alias}に`,`${alias}へ`,`${alias}のHP`,`${alias}のAP`,`${alias}を`
    ].some(token=>message.includes(token))));
    return candidates.length===1?candidates[0]:null;
}
function damageEvent(str){
    if (!/ダメージ|摩耗/.test(str)||/ダメージ軽減|ダメージ無効/.test(str))return null;
    const match=str.match(/(?:HP|AP)に\s*([\d,]+)\s*(?:の)?ダメージ/)
        ||str.match(/([\d,]+)\s*(?:の)?(?:HP|AP)ダメージ/)
        ||str.match(/([\d,]+)\s*(?:の)?ダメージ/);
    if(!match)return null;
    return {amount:Number(match[1].replaceAll(',','')),
        pool:/AP|摩耗/.test(str)?'AP':'HP',
        self:/反動|自傷|自身|毒|炎上|出血|BSによる|によりHPに/.test(str)};
}
function healEvent(str){
    if(!/回復/.test(str))return null;
    const match=str.match(/(?:HP|AP)を\s*([\d,]+)\s*回復/)
        ||str.match(/([\d,]+)\s*(?:の)?(?:HP|AP)を?回復/);
    if(!match)return null;
    return {amount:Number(match[1].replaceAll(',','')),pool:/AP|充填/.test(str)?'AP':'HP'};
}
function bsNames(str){
    if(!/BS[『「]/.test(str))return [];
    return [...new Set([...str.matchAll(/[『「]([^『「』」()]+)(?:\([^)]*\))?[』」]/g)]
        .map(match=>match[1]))];
}

export function collectOfficialMetrics(teams,rawLogs,lastTurn) {
    const members=teams.flatMap(t=>t.members||[]);
    const byId=new Map(members.map(u=>[String(u.id),u]));
    const rows=new Map(members.map(u=>[String(u.id),createRow(u)]));
    const snapshots=new Map();
    // Initialize to zero only where this entire official record contains a
    // recognized event class. Unknown/unidentifiable statistics stay null.
    const present={attacks:false,hit:false,dodge:false,ranks:false,damage:false,
        heal:false,bs:false,defense:false,resist:false,actions:false,rolls:false};
    for(const log of rawLogs){
        const type=String(log?.type||'').toUpperCase(),msg=content(log);
        if(type==='HIT_ROLL'&& !/行使判定/.test(msg))present.attacks=true;
        if(type==='HIT_TYPE_ROLL')present.ranks=present.hit=true;
        if(type==='AVOID_ROLL')present.dodge=true;
        if(type==='DEF_ROLL')present.defense=true;
        if(type==='REGIST_ROLL')present.resist=true;
        if(['DEAL_DAMAGE','DAMAGE','EFFECT','NORMAL'].includes(type)&&damageEvent(msg))present.damage=true;
        if(healEvent(msg))present.heal=true;
        if(/BS[『「]/.test(msg))present.bs=true;
        if(type==='SKILL_INFO'||type==='ACTION')present.actions=true;
        if(/1d100\s*[:：]\s*\d+/.test(msg))present.rolls=true;
    }
    for(const row of rows.values()){
        for(const [presentKey,keys] of Object.entries({
            attacks:['attacks','hitAttempts'],hit:['hitLanded'],dodge:['incomingAttempts','dodged'],
            damage:['damageGivenHP','damageGivenAP','damageTakenHP','damageTakenAP','maxGivenHP','maxTakenHP'],
            heal:['healGivenHP','healGivenAP','healReceivedHP','healReceivedAP'],
            bs:['bsInflicted','bsReceived'],defense:['defenseSuccess','defenseFailure'],
            resist:['resistSuccess','resistFailure'],actions:['actions','covered','wasCovered','defeats','drama'],
            rolls:['criticals','fumbles','diceSum','diceCount']
        })) if(present[presentKey])for(const key of keys)row[key]=0;
        if(present.ranks)row.hitRanks={G:0,L:0,C:0,H:0,S:0};
    }
    let active=null,lastTarget=null,pendingDamage=null,pendingHeal=null,turnMarker=-1;
    // Events are chronological. Damage/heal descriptions precede the next
    // state snapshot; source action and target are stored only within this turn.
    for(let i=0;i<rawLogs.length;i++){
        const log=rawLogs[i]||{},type=String(log.type||'').toUpperCase();
        const actor=byId.get(String(log.entry_id??''));
        const row=actor&&rows.get(String(actor.id));
        const msg=content(log),turn=number(log.turn)??0;
        if(turn!==turnMarker){active=null;lastTarget=null;pendingDamage=null;pendingHeal=null;turnMarker=turn;}
        const isState=log.hp!==undefined||log.ap!==undefined||log.max_hp!==undefined;
        if(isState){
            if(!actor)continue;
            const before=snapshots.get(String(actor.id))||{};
            const after={HP:number(log.hp),AP:number(log.ap)};
            for(const pool of ['HP','AP']){
                const current=after[pool],previous=before[pool];
                const stated=number(log[pool==='HP'?'add_hp':'add_ap']);
                // Prefer real snapshots; use an explicit nonzero add value when
                // states are equal (some older/partial log formats).
                const snapshotDelta=current!==null&&previous!=null?current-previous:null;
                const delta=snapshotDelta==null ? (stated!==0?stated:null) :
                    snapshotDelta!==0?snapshotDelta:(stated!==0?stated:0);
                if(delta==null||delta===0)continue;
                const damage=pendingDamage;
                if(delta<0&&damage?.pool===pool&&damage.target===actor.id&&i-damage.index<=15){
                    const amount=-delta;
                    add(row,pool==='HP'?'damageTakenHP':'damageTakenAP',amount);
                    if(pool==='HP')setMax(row,'maxTakenHP',amount);
                    const giver=rows.get(String(damage.source));
                    if(giver&&giver.team!==actor.team){
                        add(giver,pool==='HP'?'damageGivenHP':'damageGivenAP',amount);
                        if(pool==='HP')setMax(giver,'maxGivenHP',amount);
                    }
                    pendingDamage=null;
                } else if(delta>0){
                    add(row,pool==='HP'?'healReceivedHP':'healReceivedAP',delta);
                    const heal=pendingHeal;
                    if(heal?.pool===pool&&heal.target===actor.id&&i-heal.index<=15){
                        const giver=rows.get(String(heal.source));
                        if(giver)add(giver,pool==='HP'?'healGivenHP':'healGivenAP',delta);
                        pendingHeal=null;
                    }
                }
            }
            snapshots.set(String(actor.id),{HP:after.HP??before.HP??null,AP:after.AP??before.AP??null});
            continue;
        }
        if(type==='SKILL_INFO'){
            active={actor:actor?.id,turn,attackCounted:false};
            lastTarget=null;pendingDamage=null;pendingHeal=null;
            add(row,'actions');
            continue;
        }
        if(row){
            for(const match of msg.matchAll(/1d100\s*[:：]\s*(\d+)/g)){
                add(row,'diceSum',Number(match[1]));add(row,'diceCount');
            }
            if(/ファンブル[！!]/.test(msg))add(row,'fumbles');
            if(/クリティカル[！!]|クリティカル回避[！!]/.test(msg))add(row,'criticals');
        }
        if(type==='ACTION'){
            if(/防御集中|攻撃集中|行動値.*持ち越す|待機/.test(msg))add(row,'actions');
            if(/かばう[！!]/.test(msg)){
                add(row,'covered');const u=explicitTarget(msg,members);
                if(u)add(rows.get(String(u.id)),'wasCovered');
            }
        }
        if(type==='DRAMA_ROLL'){
            if(/復活|踏みとどま/.test(msg))add(row,'drama');
            if(/倒れた|戦闘不能/.test(msg)&&active?.actor){
                const giver=rows.get(String(active.actor));
                if(giver&&giver.team!==actor?.team)add(giver,'defeats');
            }
        }
        if(type==='HIT_ROLL'){
            // Buff/enchantment '行使判定' is not an attack.
            if(!/行使判定/.test(msg)){
                add(row,'hitAttempts');
                if(!active||active.actor!==actor?.id||!active.attackCounted){
                    add(row,'attacks');
                    if(active&&active.actor===actor?.id)active.attackCounted=true;
                }
            }
            continue;
        }
        if(type==='AVOID_ROLL'){
            add(row,'incomingAttempts');
            const pass=/クリティカル回避[！!]|は回避[！!]/.test(msg)?true:
                /回避(?:判定|最終値)/.test(msg)&&/＜|<|クリティカルせず/.test(msg)?false:resultOf(msg);
            if(pass===true)add(row,'dodged');
            if(actor)lastTarget=actor.id;
            continue;
        }
        if(type==='HIT_TYPE_ROLL'){
            const hit=rows.get(String(actor?.id??active?.actor??''));
            const rank=rankOf(msg);
            if(hit&&rank){
                if(!hit.hitRanks)hit.hitRanks={G:0,L:0,C:0,H:0,S:0};
                hit.hitRanks[rank]++;add(hit,'hitLanded');
            }
            continue;
        }
        if(type==='DEF_ROLL'){
            const passed=/防御できない/.test(msg)?false:resultOf(msg);
            if(passed!==null)add(row,passed?'defenseSuccess':'defenseFailure');
            continue;
        }
        if(type==='REGIST_ROLL'){
            const passed=resultOf(msg);
            if(passed!==null)add(row,passed?'resistSuccess':'resistFailure');
            if(actor)lastTarget=actor.id;
            continue;
        }
        if(type==='BS_SHRINK_ROLL'||type==='EFFECT_TRIGGER'||type==='SPD_ROLL')continue;
        if(['EFFECT','NORMAL'].includes(type)&& /にBS[『「]/.test(msg)){
            const names=bsNames(msg);
            const target=explicitTarget(msg,members)||byId.get(String(lastTarget));
            if(names.length&&target){
                add(rows.get(String(target.id)),'bsReceived',names.length);
                const giver=row||rows.get(String(active?.actor));
                if(giver&&giver.team!==target.team)add(giver,'bsInflicted',names.length);
            }
        }
        const damage=damageEvent(msg);
        if(damage && ['DEAL_DAMAGE','DAMAGE','EFFECT','NORMAL'].includes(type)){
            const target=explicitTarget(msg,members)||
                (type!=='DEAL_DAMAGE'&&damage.self?actor:null)||
                byId.get(String(lastTarget));
            if(target&&damage.amount>0){
                const source=type==='DEAL_DAMAGE'?actor?.id:
                    (damage.self?actor?.id:actor?.id||active?.actor);
                pendingDamage={index:i,pool:damage.pool,target:target.id,source};
            }
        }
        const heal=healEvent(msg);
        if(heal&& ['EFFECT','HEAL','RECOVERY','ACTION','NORMAL'].includes(type)){
            const target=explicitTarget(msg,members)||actor;
            if(target&&heal.amount>0)pendingHeal={index:i,pool:heal.pool,target:target.id,
                source:actor?.id??active?.actor};
        }
    }
    const turns=Math.max(1,Number(lastTurn)||1);
    return [...rows.values()].map(row=>({
        ...row,
        avgDamageGivenHP:row.damageGivenHP==null?null:row.damageGivenHP/turns,
        avgDamageGivenAP:row.damageGivenAP==null?null:row.damageGivenAP/turns,
        avgDamageTakenHP:row.damageTakenHP==null?null:row.damageTakenHP/turns,
        avgDamageTakenAP:row.damageTakenAP==null?null:row.damageTakenAP/turns,
        accuracyRate:row.hitAttempts&&row.hitLanded!=null?row.hitLanded/row.hitAttempts*100:null,
        dodgeRate:row.incomingAttempts&&row.dodged!=null?row.dodged/row.incomingAttempts*100:null,
        diceAverage:row.diceCount?row.diceSum/row.diceCount:null,
        measuredTurns:lastTurn
    }));
}
