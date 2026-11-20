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
                item.snapshot={hp:unit.hp,ap:unit.ap,maxHp:unit.maxHp,maxAp:unit.maxAp};
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
    return {id:String(payload?.battleId ?? result.battle?.id ?? ''),
        name:safe(result.battle?.name,140) || '公式闘技場の戦闘ログ',teams,logs,lastTurn,
        statistics: officialArenaStatistics({teams, lastTurn}),
        counts:{turns:lastTurn,entries:logs.length}, source:'official'};
}
// Official STATE records identify the affected member, but do not always
// identify who dealt damage or performed healing. Unknown counters stay null,
// never zero. Reuse the local battle-statistics presentation for both sources.
export function officialArenaStatistics(battle) {
    const turns = Math.max(1, Number(battle?.lastTurn ?? battle?.counts?.turns) || 1);
    return (battle?.teams || []).flatMap(team => (team.members || []).map(u => ({
        id: u.id, name: u.name, team: u.team,
        damageGivenHP: null, damageGivenAP: null,
        damageTakenHP: u.hasDeltaHP ? u.hpDamage : null,
        damageTakenAP: u.hasDeltaAP ? u.apDamage : null,
        healGivenHP: null, healGivenAP: null,
        healReceivedHP: u.hasDeltaHP ? u.hpHealing : null,
        healReceivedAP: u.hasDeltaAP ? u.apHealing : null,
        avgDamageTakenHP: u.hasDeltaHP ? u.hpDamage / turns : null,
        avgDamageTakenAP: u.hasDeltaAP ? u.apDamage / turns : null,
        avgDamageGivenHP: null, avgDamageGivenAP: null,
        hitRanks: null
    })));
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
