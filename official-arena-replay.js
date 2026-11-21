// Official arena replay uses the public chronological state snapshots.
// Never simulate movement, HP/AP costs, or unspecified coordinates: show only
// values supported by the imported result. The regular Battle engine is untouched.
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
export function officialPosition(value) {
    if (typeof value === 'string') {
        const found = /^\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*$/.exec(value);
        if (found) return {x:Number(found[1]),y:Number(found[2])};
    } else if (value && typeof value === 'object') {
        const x=finite(value.x), y=finite(value.y);
        if (x!==null && y!==null) return {x,y};
    }
    return null;
}
const newUnit = u => ({
    id:u.id, name:u.name, team:u.team,
    hp:null, maxHp:null, ap:null, maxAp:null,
    x:null,y:null,barrier:0,bs:[],damageDealt:0,alive:true
});
const copyUnits = members => members.map(u=>({...u,bs:u.bs.map(b=>({...b}))}));
function applySnapshot(unit,snapshot) {
    if (!unit || !snapshot) return;
    for(const [key,value] of [['hp','hp'],['maxHp','maxHp'],['ap','ap'],['maxAp','maxAp']]) {
        if(finite(snapshot[value])!==null)unit[key]=Number(snapshot[value]);
    }
    if(snapshot.position){unit.x=snapshot.position.x;unit.y=snapshot.position.y;}
    if(Array.isArray(snapshot.bs))unit.bs=snapshot.bs.map(b=>({name:b.name,remaining:b.remaining}));
    if(finite(unit.hp)!==null)unit.alive=unit.hp>0;
}
const isMeaningful = log => log?.kind==='state' || ['START_TURN','ACTION','DEAL_DAMAGE','DAMAGE','EFFECT','END_BATTLE_MESSAGE'].includes(String(log?.type||''));
function directDamage(log, members) {
    if(log?.type!=='DEAL_DAMAGE')return 0;
    const actor=members.find(u=>String(u.id)===String(log.entryId));
    if(!actor)return 0;
    const message=String(log.text||'');
    const match=/^(.+?)の(?:HP|AP)に\s*([\d,]+)\s*(?:の)?ダメージ/.exec(message);
    if(!match)return 0;
    const targetName=match[1].trim();
    const recipients=members.filter(u=>[u.name,...u.name.split(/[\s　・･]+/)].includes(targetName));
    if(recipients.length!==1||recipients[0].team===actor.team)return 0;
    return Number(match[2].replaceAll(',',''));
}
/**
 * @returns {{frames:Array,logFrameIndices:number[]}}
 * frames include a stable initial position and subsequent public snapshots.
 * logFrameIndices map *every* original event back to the closest available frame.
 */
export function buildOfficialArenaReplay(teams,logs) {
    const memberRows=(teams||[]).flatMap(t=>t.members||[]).map(newUnit);
    const idMap=new Map(memberRows.map(u=>[String(u.id),u]));
    // START_TURN_INFO provides both sides' actual starting HP/AP/coordinates.
    // Using it as the initial state avoids a misleading half-initialized map.
    for (const unit of memberRows) {
        const first=(logs||[]).find(log=>log.kind==='state' && String(log.entryId)===String(unit.id));
        if(first)applySnapshot(unit,first.snapshot);
    }
    const frames=[{logIndex:-1,turn:0,label:'戦闘開始時',actorId:null,units:copyUnits(memberRows)}];
    const logFrameIndices=[];
    const maxFrames=4000;
    for(let i=0;i<(logs||[]).length;i++){
        const log=logs[i];
        if(log.kind==='state')applySnapshot(idMap.get(String(log.entryId)),log.snapshot);
        const dealt=directDamage(log,memberRows);
        if(dealt && idMap.has(String(log.entryId))) idMap.get(String(log.entryId)).damageDealt+=dealt;
        if(isMeaningful(log)&&frames.length<maxFrames){
            const label=log.kind==='state' ? `${log.actorName||'ユニット'}：HP/AP・位置更新` : String(log.text||`第${log.turn}ターン`).slice(0,120);
            frames.push({logIndex:i,turn:log.turn,label,actorId:idMap.has(String(log.entryId))?String(log.entryId):null,units:copyUnits(memberRows)});
        }
        logFrameIndices.push(frames.length-1);
    }
    return {frames,logFrameIndices};
}
