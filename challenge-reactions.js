// Presentation-only scripted lines for Serara Normal and HARD challenges.
// These are derived from resolved engine logs; combat outcomes and AI are unchanged.
import {CHALLENGE_BOSS_ID,isSeraraChallengeId} from './challenge-content.js?v=1.18.19&hard=1';

export const SERARA_REACTION_LINES=Object.freeze({
    start:'甘味騎士セララだよ。よろしくねっ',
    victory:'ボクの勝ちだからドーナツを奢ってね♪',
    draw:'引き分けだね。またバトルしようねっ',
    defeat:'つ、次は負けないもーん！',
    drama:'ドーナツを食べてふっかーつ！',
    ko:'ばたんきゅ～',
    finishing:'これでトドメ！　セララスペシャル！'
});

const LABELS=Object.freeze({
    start:'試合開始前',victory:'勝利',draw:'引き分け',defeat:'敗北',
    drama:'ドラマ成功',ko:'KO',finishing:'フィニッシュ'
});

/**
 * Every event is tied to a *resolved* battle log, not a predicted attack.
 * The opening line is intentionally not an engine log, and no reaction can
 * affect combat calculations, seed determinism or KO/drama resolution.
 */
export function buildSeraraReactions(battle) {
    if (!isSeraraChallengeId(battle?.config?.challenge?.id)) return [];
    const events=[{key:'start',label:LABELS.start,text:SERARA_REACTION_LINES.start,logId:null,frameIndex:-1}];
    const logs=Array.isArray(battle.logs)?battle.logs:[];
    for (let i=0;i<logs.length;i++) {
        const log=logs[i];
        let key=null;
        if (log.type==='drama' && log.actor===CHALLENGE_BOSS_ID)
            key='drama';
        else if (log.type==='down' && log.target===CHALLENGE_BOSS_ID)
            key='ko';
        else if (log.type==='down' && log.actor===CHALLENGE_BOSS_ID && log.target!==CHALLENGE_BOSS_ID) {
            // Show a finishing blow only when Serara directly knocks out the
            // challenger, not when a DoT/sudden-death tick or another effect does.
            const prior=logs[i-1];
            if (prior && ['damage','pursuit'].includes(prior.type) &&
                prior.actor===CHALLENGE_BOSS_ID && prior.target===log.target &&
                prior.turn===log.turn && prior.gauge===log.gauge &&
                !/反射/.test(prior.detail||'')) key='finishing';
        }
        if (key) events.push({key,label:LABELS[key],text:SERARA_REACTION_LINES[key],
            logId:log.id,frameIndex:log.frameIndex});
    }
    if (battle.done) {
        const key=battle.winner==='B'?'victory':battle.winner==='A'?'defeat':'draw';
        const lastResult=logs.findLast(log=>log.type==='result')||logs.at(-1);
        events.push({key,label:LABELS[key],text:SERARA_REACTION_LINES[key],
            logId:lastResult?.id??null,frameIndex:lastResult?.frameIndex??Math.max(0,(battle.frames?.length??1)-1)});
    }
    return events;
}

/** Resolve the reaction for the selected log (when present) or replay frame. */
export function seraraReactionAt(battle,frameIndex,selectedLogId=-1) {
    const events=buildSeraraReactions(battle);
    if(!events.length) return null;
    // Opening log / first replay snapshot: allow the greeting to be revisited
    // after the match, before T01 begins. Other events remain log-gated.
    if(frameIndex===0 && selectedLogId===-1) return events[0];
    if(!battle.logs?.length) return events[0];
    const byLog=Number.isInteger(selectedLogId)&&selectedLogId>=0;
    // When two different log entries share a snapshot, log id is decisive.
    const applicable=events.filter(e=>e.logId!==null && e.frameIndex<=frameIndex &&
        (!byLog || e.logId<=selectedLogId));
    return applicable.at(-1)||null;
}

export function seraraReactionByLog(battle) {
    const map=new Map();
    for(const item of buildSeraraReactions(battle)) {
        if(item.logId==null) continue;
        const list=map.get(item.logId)||[];
        list.push(item); map.set(item.logId,list);
    }
    return map;
}
