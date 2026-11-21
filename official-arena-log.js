import {collectOfficialMetrics} from './official-arena-metrics.js';
import {buildOfficialArenaReplay,officialPosition} from './official-arena-replay.js';
// Viewer for public official Arena battle results. This module never alters a
// Battle Lab simulation and never requests credentials or session cookies.
const ID_RE = /^\/[a-z]+\/battle\/([1-9]\d{0,9})\/?$/;
export function officialArenaBattleId(value) {
    let url;
    try { url = new URL(String(value ?? '').trim()); }
    catch { throw Error('公式闘技場の対戦結果URLを入力してください。'); }
    const match = ID_RE.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'rev2.reversion.jp' || url.port ||
        url.username || url.password || url.search || url.hash || !match || !url.pathname.startsWith('/arena/'))
        throw Error('https://rev2.reversion.jp/arena/battle/番号 の形式で入力してください。');
    return match[1];
}
const num = n => n == null || n === '' ? null : Number.isFinite(Number(n)) ? Number(n) : null;
const safe = (n, max=500) => typeof n === 'string' ? n.slice(0,max) : typeof n === 'number' ? String(n) : '';
export function parseOfficialArenaResult(payload) {
    const result = payload?.result || payload?.data?.rev2ArenaBattleGetResult;
    if (!result || !Array.isArray(result.teams) || !Array.isArray(result.logs))
        throw Error('公式ログの取得データ形式が正しくありません。');
    if (result.teams.length > 8 || result.logs.length > 25000)
        throw Error('ログの量が多いため閲覧できません。');
    const teams = [], byEntry = new Map();
    for (let i=0; i<result.teams.length; i++) {
        const team = result.teams[i];
        if (!Array.isArray(team?.entries)) continue;
        const teamId = i === 0 ? 'A' : i === 1 ? 'B' : String(i+1);
        const members = [];
        for (const [index,entry] of team.entries.entries()) {
            if (!entry) continue;
            const id = String(entry.id ?? '');
            if (!id || byEntry.has(id)) continue;
            const member = { id, name: safe(entry.character?.name,80) || `ユニット${index+1}`,
                team:teamId, characterId:safe(entry.character?.character_id,24),
                hp:null,maxHp:null,ap:null,maxAp:null,
                hpDamage:0,apDamage:0,hpHealing:0,apHealing:0,hasDeltaHP:false,hasDeltaAP:false };
            byEntry.set(id,member); members.push(member);
        }
        teams.push({id:teamId,name:safe(team.name,100) || `TEAM ${teamId}`,members});
    }
    if (!byEntry.size) throw Error('対戦の参加者情報を取得できませんでした。');
    const logs=[], maxTurn=25;
    const original=Array.from(result.logs);
    const mapSize=Math.max(30,Math.min(1000,Math.max(num(result.battle?.map?.width)||150,num(result.battle?.map?.height)||150)));
    for (let i=0; i<original.length; i++) {
        const raw=original[i];
        if (!raw || typeof raw !== 'object') continue;
        const turn=Math.max(0,Math.min(maxTurn,Math.floor(num(raw.turn) ?? 0)));
        const entryId=String(raw.entry_id ?? '');
        const unit=byEntry.get(entryId);
        const state=raw.hp !== undefined || raw.ap !== undefined || raw.max_hp !== undefined;
        const item={id:i,turn,entryId, actorName:unit?.name||'',type:safe(raw.type,45),text:'',roll:'',kind:'message'};
        if (state) {
            item.kind='state';
            if (unit) {
                const hp=num(raw.hp), ap=num(raw.ap), maxHp=num(raw.max_hp), maxAp=num(raw.max_ap);
                const deltaHP=num(raw.add_hp), deltaAP=num(raw.add_ap);
                // add_hp/add_ap represent the change in this official state log.
                // Do not infer who inflicted it; the official log does not always
                // carry an attacker reference for the state change.
                if (deltaHP !== null) {
                    unit.hasDeltaHP=true;
                    if (deltaHP < 0) unit.hpDamage += -deltaHP;
                    else unit.hpHealing += deltaHP;
                }
                if (deltaAP !== null) {
                    unit.hasDeltaAP=true;
                    if (deltaAP < 0) unit.apDamage += -deltaAP;
                    else unit.apHealing += deltaAP;
                }
                if (hp!==null) unit.hp=hp;
                if (ap!==null) unit.ap=ap;
                if (maxHp!==null) unit.maxHp=maxHp;
                if (maxAp!==null) unit.maxAp=maxAp;
                const position=officialPosition(raw.position);
                const statuses=Array.isArray(raw.options) ? raw.options.filter(option=>/BadStatus|BattleStatus|BS/i.test(String(option?.type||''))).map(option=>({name:safe(option.name,80),remaining:Math.max(0,num(option.remain)||0)})) : null;
                item.snapshot={hp:unit.hp,ap:unit.ap,maxHp:unit.maxHp,maxAp:unit.maxAp,position,bs:statuses};
                item.text=`HP ${unit.hp??'—'}/${unit.maxHp??'—'}  AP ${unit.ap??'—'}/${unit.maxAp??'—'}`;
            }
        } else if (raw.skill_id != null) {
            item.kind='skill';
            item.text=`スキル発動（ID ${safe(raw.skill_id,40)}）`;
        } else {
            item.text=safe(raw.text,2400) || safe(raw.talk,2400) || safe(raw.type,100) || '記録';
            if (raw.roll !== undefined && raw.roll !== null) {
                const roll = typeof raw.roll==='object' ? JSON.stringify(raw.roll) : String(raw.roll);
                item.roll=roll.slice(0,900);
            }
        }
        logs.push(item);
    }
    const lastTurn=Math.max(0,...logs.map(l=>l.turn));
    const {frames,logFrameIndices}=buildOfficialArenaReplay(teams,logs);
    logs.forEach((log,index)=>{ log.replayFrame=logFrameIndices[index]; });
    return {id:String(payload?.battleId ?? result.battle?.id ?? ''),
        name:safe(result.battle?.name,140) || '公式闘技場の戦闘ログ',schemaVersion:4,teams,logs,lastTurn,mapSize,frames,
        statistics: collectOfficialMetrics(teams,original,lastTurn),
        counts:{turns:lastTurn,entries:logs.length}, source:'official'};
}
// Official STATE records identify the affected member, but do not always
// identify who dealt damage or performed healing. Unknown counters stay null,
// never zero. Reuse the local battle-statistics presentation for both sources.
export function officialArenaStatistics(battle) {
    if(Array.isArray(battle?.statistics))return battle.statistics;
    // Compatibility with already-open v1.18.6 sessions. Never interpret
    // unexplained AP expenses or HP recoil as an opponent's damage.
    return (battle?.teams||[]).flatMap(team=>(team.members||[]).map(u=>({
        id:u.id,name:u.name,team:u.team,hitRanks:null,
        damageGivenHP:null,damageGivenAP:null,damageTakenHP:null,damageTakenAP:null,
        healGivenHP:null,healGivenAP:null,healReceivedHP:null,healReceivedAP:null
    })));
}
// Default view keeps actions and outcomes, putting repetitive dice rolls and
// HP/AP snapshots into per-turn disclosure panels. The original data stays in memory.
export function officialArenaVisibleLog(logs) {
    const groups=[],byTurn=new Map();
    for(const log of logs||[]){
        if(!byTurn.has(log.turn)){
            const group={turn:log.turn,main:[],details:[],totalDetails:0,omitted:0};byTurn.set(log.turn,group);groups.push(group);
        }
        const group=byTurn.get(log.turn);
        const message=String(log.text||'');
        const code=String(log.type||'').toUpperCase();
        const rank=/(グレイズ|ライト|クリーン|ハード|スマッシュ)ヒット/.exec(String(log.roll||''));
        let isMain=false;
        if(code==='START_TURN' || code==='END_BATTLE_DETAIL') {
            // Turn headings are already displayed, and team totals live in statistics.
            isMain=false;
        } else if(code==='EFFECT' && /にBS[『「]/.test(message)) {
            const distinct=[...new Set([...message.matchAll(/[『「]([^『「』」()]+)(?:\([^)]*\))?[』」]/g)].map(m=>m[1]))];
            const receiver=message.split('にBS')[0];
            group.main.push({...log,summary:`${receiver}にBS ${distinct.length}種類（${distinct.join('・')}）を付与！`});isMain=true;
        } else if(code==='HIT_TYPE_ROLL'&&rank){
            group.main.push({...log,summary:rank[0]});isMain=true;
        } else if(code==='AVOID_ROLL' && (/成功[！!]?/.test(String(log.roll||'')) || /クリティカル回避[！!]|は回避[！!]/.test(message))){
            group.main.push({...log,summary:/クリティカル回避/.test(message)?'クリティカル回避':'回避成功'});isMain=true;
        } else if(code==='HIT_ROLL' && /発動に失敗/.test(message)){
            group.main.push({...log,summary:message});isMain=true;
        } else {
            const hide=log.kind==='state'||log.kind==='skill'||Boolean(log.roll)||
                /(?:^|_)ROLL$|EFFECT_TRIGGER|SPD_ROLL|BS_SHRINK_ROLL/.test(code)||
                /行動中|行動完了|行動値持ち越し中|速度判定|自動位置取り中|まで移動|スキル発動（ID/.test(message)||
                /^HP\s*-?\d/.test(message);
            if(!hide&&message){group.main.push(log);isMain=true;}
        }
        // Cap initial DOM size for BS-heavy official fights. The original
        // records remain available in the loaded battle and on the source page.
        if(!isMain){
            group.totalDetails++;
            if(group.details.length<240)group.details.push(log);
            else group.omitted++;
        }
    }
    return groups;
}

export async function loadOfficialArenaViaWorker(url, workerUrl, fetchImpl=fetch) {
    const id=officialArenaBattleId(url);
    const base=new URL(String(workerUrl||''));
    if (base.protocol!=='https:' || !base.hostname.endsWith('.workers.dev')) throw Error('WorkerのURL設定が正しくありません。');
    let response;
    try {
        response=await fetchImpl(base.origin+'/arena/battle',{
            method:'POST', mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
            headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({url:`https://rev2.reversion.jp/arena/battle/${id}`}),
            signal:AbortSignal.timeout(25000)
        });
    } catch(e) {throw Error(e?.name==='TimeoutError'||e?.name==='AbortError'?'公式ログの取得がタイムアウトしました。':'Workerとの通信に失敗しました。');}
    let payload;
    try {payload=await response.json();}
    catch {throw Error('公式ログの応答形式を読み込めませんでした。');}
    if (!response.ok || payload?.ok!==true) throw Error(safe(payload?.error,250)||'公式闘技場のログを取得できませんでした。');
    const parsed=parseOfficialArenaResult(payload);
    parsed.id=id;
    return parsed;
}
