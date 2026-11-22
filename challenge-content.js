// v1.18.15: challenge catalog. The boss is intentionally not exposed via character/AI editors.
// Challenge data is bundled client-side to run the offline simulation. This is a UI lock,
// not cryptographic secrecy against users inspecting downloaded JavaScript.
import { clone, freshUnit, freshRule, freshCondition, validateConfig, arrangeInitialPositions } from './model.js?v=1.18.21&dialogueui=1';
import { importUnitCharacter } from './unit-character-io.js?v=1.18.21&dialogueui=1';
import { SERARA_HARD_CHARACTER, seraraHardAiRules } from './serara-hard-data.js?v=1.18.21&hard=1';

export const CHALLENGE_BOSS_ID = 'challenge-serara-normal-boss';
export const CHALLENGES = Object.freeze([
  Object.freeze({ id: 'serara-normal', title: 'セララチャレンジ', difficulty: 'Normal', teamALimit: 1, enemyName: '甘咲 セララ', icon: './assets/serara-challenge-icon.png' }),
  Object.freeze({ id: 'serara-hard', title: 'セララチャレンジ', difficulty: 'HARD', teamALimit: 8, enemyName: '甘咲 セララ', icon: './assets/serara-challenge-icon.png' })
]);
export const isSeraraChallengeId = (id) => id === 'serara-normal' || id === 'serara-hard';
export function activeChallenge(config) { return CHALLENGES.find(c=>c.id===config?.challenge?.id) || null; }
export function canEditChallengeUnit(config, unit) { return !activeChallenge(config) || unit?.team==='A'; }
export function challengePartyValid(config) {
  const c=activeChallenge(config);
  return !c || (config.units.filter(u=>u.team==='A').length>=1 && config.units.filter(u=>u.team==='A').length<=c.teamALimit && config.units.filter(u=>u.team==='B').length===1 && config.units.find(u=>u.team==='B')?.id===CHALLENGE_BOSS_ID);
}
const SERARA_CHARACTER = {"format":"rosuaka-unit-character","version":1,"sourceUnit":{"id":"b1","name":"甘咲 セララ","team":"B"},"character":{"name":"甘咲 セララ","maxHp":12000,"maxAp":9000,"main":350,"sub":1000,"heal":0,"hit":100,"evade":110,"defense":85,"resist":85,"speed":300,"mobility":12,"critical":20,"fumble":10,"drama":-3,"startHp":100,"startAp":100,"normalRange":"touch","normalBS":[],"element":{"key":"風","value":5},"effects":{},"conditionalPassives":[],"initialBS":[],"immunities":[],"importedProfile":{"characterId":"r2p000056","url":"https://rev2.reversion.jp/character/detail/r2p000056","fetchedAt":"2026-11-21T07:20:02.712Z","references":[{"category":"常時補正","name":"上限解放III","original":"CP+24【グループ：上限解放】"},{"category":"常時補正","name":"近接武装熟練III","original":"主攻+50、副攻+30、命中+5、回避+5【装制：レンジ0】【グループ：近接武装熟練】"},{"category":"常時補正","name":"中距離武装熟練III","original":"主攻+40、副攻+40、命中+7、回避+3【装制：レンジ1～2】【グループ：中距離武装熟練】"},{"category":"常時補正","name":"発勁","original":"防技+4、抵抗+4、速度+8、命中+2、回避+2、ドラマ+4"},{"category":"常時補正","name":"光明","original":"主攻+5、副攻+5、防技+1、抵抗+1、命中+1、回避+1、CT+1、FB-1"},{"category":"クラス","name":"梁山泊","original":"HP+500、速度+20、命中+5、回避+5"},{"category":"クラス","name":"ライバル","original":"HP+275、副攻+25、命中+1【シナリオ時、該当職の基礎行動に若干の有利補正を受ける】"},{"category":"エスプリ","name":"玄境","original":"HP+900、命中+9、回避+9、CT+1、FB-1【シナリオ時、武人同士の戦闘である時、命中+3、回避+2】"}],"otherStats":[{"name":"活性限界値","value":35,"type":"SUB_STATUS"},{"name":"火属性値","value":0,"type":"ELEMENT"},{"name":"水属性値","value":0,"type":"ELEMENT"},{"name":"土属性値","value":0,"type":"ELEMENT"},{"name":"風属性値","value":5,"type":"ELEMENT"},{"name":"光属性値","value":0,"type":"ELEMENT"},{"name":"紫電属性値","value":0,"type":"ELEMENT"},{"name":"無属性値","value":0,"type":"ELEMENT"}],"warnings":[],"unsupported":[]}},"tactics":{"format":"rosuaka-unit-tactics","version":1,"sourceUnit":{"id":"b1","name":"甘咲 セララ"},"skills":["acc-mwq2vuih-6","acc-mwq2vuim-7","acc-mwq2vuis-8","wiki-164","wiki-063"],"rules":[{"id":"r-mwq2vuj2-9","enabled":true,"conditions":[{"type":"who","subject":"enemies","characterId":"","metric":"alive","min":0,"max":100,"not":false,"bs":[],"multiple":1,"offset":1,"chance":50}],"action":"effectiveAttack","skillId":"","target":"enemies","targetUnitId":"","sort":"nearest","targetConditions":[],"autoMove":true,"moveMode":"approach","minDist":0,"maxDist":3,"splitMovement":false,"moveTargetMode":"same","moveSubject":"previous","moveUnitId":"","moveConditions":[],"moveSort":"nearest","movePriority":"action"},{"id":"r-mwq2vuj2-10","enabled":true,"conditions":[],"action":"carry","skillId":"","target":"self","targetUnitId":"","sort":"nearest","targetConditions":[],"autoMove":false,"moveMode":"fixed","minDist":0,"maxDist":3,"splitMovement":false,"moveTargetMode":"same","moveSubject":"previous","moveUnitId":"","moveConditions":[],"moveSort":"nearest","movePriority":"action"}],"customSkills":[{"id":"acc-mwq2vuih-6","name":"セララフェニックス","kind":"attack","ap":600,"cost":150,"range":"mid","scope":"single","customRange":20,"radius":5,"mainPct":100,"mainBonus":0,"subPct":100,"subBonus":240,"hitBonus":30,"power":0,"bs":["崩れ","呪縛"],"bsTurns":3,"buffTurns":8,"modifiers":{},"effects":{"demon":30,"evil":30,"multiShadow":1,"offensiveCleanse":35},"trigger":"instant","passiveWhen":"always","interval":1,"note":"超高熱の炎を剣に纏わせ、突撃します。\nスキル使用時は背に炎翼が展開され、周囲を火の粉が舞います。","castMods":{"critical":7,"fumble":7},"grantedEffects":{},"selfModifiers":{},"selfEffects":{},"elements":{},"elementCorrection":0,"original":"中単：命中+30、主攻+0、副攻+240、CT+7、FB+7【崩れ】【呪縛】【鬼道30】【邪道30】【多重影1】【攻勢BS回復35】","originSkillId":"8582896","baseName":"","unmodeled":[],"importedFromCharacter":{"characterId":"r2p000056","skillId":"8582896","url":"https://rev2.reversion.jp/character/detail/r2p000056"}},{"id":"acc-mwq2vuim-7","name":"ウィンドセララソード","kind":"attack","ap":300,"cost":130,"range":"near","scope":"single","customRange":20,"radius":5,"mainPct":100,"mainBonus":320,"subPct":100,"subBonus":0,"hitBonus":18,"power":0,"bs":[],"bsTurns":3,"buffTurns":8,"modifiers":{},"effects":{"offensiveCleanse":30},"trigger":"instant","passiveWhen":"always","interval":1,"note":"風の魔力を剣に纏わせて攻撃する魔法剣です。","castMods":{"critical":3},"grantedEffects":{},"selfModifiers":{},"selfEffects":{},"elements":{"風":1},"elementCorrection":0,"original":"近単：風+1、命中+18、主攻+320、CT+3【攻勢BS回復30】","originSkillId":"7458046","baseName":"覇気閃","unmodeled":[],"importedFromCharacter":{"characterId":"r2p000056","skillId":"7458046","url":"https://rev2.reversion.jp/character/detail/r2p000056"}},{"id":"acc-mwq2vuis-8","name":"セララチャーム","kind":"attack","ap":500,"cost":160,"range":"mid","scope":"wide","customRange":20,"radius":5,"mainPct":100,"mainBonus":0,"subPct":100,"subBonus":0,"hitBonus":40,"power":0,"bs":["業炎","激怒"],"bsTurns":3,"buffTurns":8,"modifiers":{},"effects":{"erosion":110,"noDamage":1,"identify":1},"trigger":"instant","passiveWhen":"always","interval":1,"note":"言霊を乗せた挑発や会話を行います。\n敵はセララを意識が釘付けとなり、視線を外せなくなります。\nそれは怒りだったり、魅了だったり、それ以外の感情だったりと人により様々です。","castMods":{},"grantedEffects":{},"selfModifiers":{},"selfEffects":{},"elements":{"風":1},"elementCorrection":0,"original":"中域：風+1、命中+40【業炎】【激怒】【摩耗110】【ダ無】【識別】","originSkillId":"7458050","baseName":"煽風點火","unmodeled":[],"importedFromCharacter":{"characterId":"r2p000056","skillId":"7458050","url":"https://rev2.reversion.jp/character/detail/r2p000056"}}],"skillAliases":{"wiki-164":"セララおやつタイム","wiki-063":"セララブレイク"},"specializedSkills":{"acc-mwq2vuim-7":{"name":"ウィンドセララソード","baseName":"覇気閃","note":"風の魔力を剣に纏わせて攻撃する魔法剣です。","original":"近単：風+1、命中+18、主攻+320、CT+3【攻勢BS回復30】","originSkillId":"7458046"},"acc-mwq2vuis-8":{"name":"セララチャーム","baseName":"煽風點火","note":"言霊を乗せた挑発や会話を行います。\n敵はセララを意識が釘付けとなり、視線を外せなくなります。\nそれは怒りだったり、魅了だったり、それ以外の感情だったりと人により様々です。","original":"中域：風+1、命中+40【業炎】【激怒】【摩耗110】【ダ無】【識別】","originSkillId":"7458050"},"wiki-164":{"name":"セララおやつタイム","baseName":"武身一致","note":"どこからともなくドーナツを取り出し一瞬でもぐもぐ。ドーナツの美味しさにより隠された真の力が解放される。たまに食べきれず、ドーナツを口に咥えたまま戦闘を続行する。","original":"自単：【副】【自：命中+7】【自：FB-2】","originSkillId":"7458047"},"wiki-063":{"name":"セララブレイク","baseName":"天冠砕き","note":"闘気を込めた強力な一撃を放つ剣技です。","original":"近単：命中+10、主攻+480【痺れ】【足止】【重圧】【必殺2】【反動300】【弱点1】","originSkillId":"8708384"}},"officialSkillIds":{"acc-mwq2vuih-6":"8582896","acc-mwq2vuim-7":"7458046","acc-mwq2vuis-8":"7458050","wiki-164":"7458047","wiki-063":"8708384"}}};
function condition(subject,metric,min,max) {
  return {...freshCondition(),subject,metric,min,max};
}
function seraraAiRules() {
  const rule = (options)=>freshRule({enabled:true,conditions:[],...options});
  const auto={autoMove:true,moveMode:'fixed',minDist:0,maxDist:3,movePriority:'action'};
  const weakest=[{type:'sort',sort:'hp'}];
  // Rule priorities/targets follow セララAI.txt; attack-position bands are
  // optimized in v1.18.17, preserving the source attributes and five skills.
  return [
    rule({...auto,conditions:[condition('enemies','hp',1,250)],action:'skill',skillId:'wiki-063',target:'previous'}),
    // v1.18.17: fixed-range tuning on 18 synthetic archetypes × 3 starting distances.
    // At 0–3m Serara over-approaches and wastes AV against mobile/ranged opponents.
    // Keep Phoenix inside its legal 20m band without requiring melee contact.
    rule({...auto,minDist:9,maxDist:14,conditions:[condition('all','alive',0,100)],action:'skill',skillId:'acc-mwq2vuih-6',target:'enemies',targetCriteria:weakest}),
    // EffectiveAttack should not undo the ranged position by rushing back to 0–3m.
    rule({...auto,minDist:12,maxDist:20,conditions:[condition('all','alive',0,100)],action:'effectiveAttack',target:'enemies',targetCriteria:weakest}),
    rule({conditions:[condition('all','alive',0,100)],action:'attack',target:'enemies',autoMove:false}),
    rule({conditions:[condition('enemies','distance',0,40)],action:'carry',target:'self',autoMove:false}),
    rule({conditions:[condition('enemies','distance',40,99)],action:'move',target:'previous',autoMove:true,moveMode:'fixed',minDist:0,maxDist:40})
  ];
}
/** Switch to a challenge while keeping an entire reversible backup of the normal formation. */
export function startChallenge(config, id, preferredAId) {
  const chosen=CHALLENGES.find(c=>c.id===id);
  if (!chosen) throw Error('未対応のチャレンジです。');
  // Each new challenge must supply its own boss data and AI builder.
  if (!isSeraraChallengeId(id)) throw Error('このチャレンジの敵データは未実装です。');
  if (activeChallenge(config)) throw Error('チャレンジを終了してから別のチャレンジを選択してください。');
  const existingA=config.units.filter(u=>u.team==='A');
  if (!existingA.length) throw Error('チームAに参加キャラが必要です。');
  const selectedA=existingA.find(u=>u.id===preferredAId)||existingA[0];
  const next=clone(config);
  // HARD starts with every available participant (up to eight); Normal retains one.
  // If there are more than eight, the current selection gets first priority.
  const entrants=chosen.teamALimit===1?[selectedA]:[...existingA.slice(0,chosen.teamALimit)];
  if(chosen.teamALimit>1 && !entrants.some(u=>u.id===selectedA.id)) entrants[entrants.length-1]=selectedA;
  next.units=[...entrants.map(u=>clone(u)),freshUnit({id:CHALLENGE_BOSS_ID,name:chosen.enemyName,team:'B',x:10,y:0,skills:[]})];
  arrangeInitialPositions(next.units);
  const loaded=importUnitCharacter(next,CHALLENGE_BOSS_ID,id==='serara-hard'?SERARA_HARD_CHARACTER:SERARA_CHARACTER);
  const boss=loaded.config.units.find(u=>u.id===CHALLENGE_BOSS_ID);
  boss.rules=id==='serara-hard'?seraraHardAiRules():seraraAiRules();
  // The imported user JSON contains exactly these skill IDs. If the importer
  // remapped a conflicting custom skill, select the actual imported ID.
  // If the importer remapped an ID because an entrant already defined it,
  // repair every rule reference using the skill's official origin ID.
  const sourceSkills=(id==='serara-hard'?SERARA_HARD_CHARACTER:SERARA_CHARACTER).tactics;
  for (const rule of boss.rules) {
    if (rule.action!=='skill' || boss.skills.includes(rule.skillId)) continue;
    const original=sourceSkills.officialSkillIds?.[rule.skillId];
    const mapped=Object.entries(boss.officialSkillIds||{}).find(([,v])=>v===original)?.[0];
    if (!mapped || !boss.skills.includes(mapped)) throw Error('チャレンジのスキル対応を確認できません：'+rule.skillId);
    rule.skillId=mapped;
  }
  boss.x=10;boss.y=0;
  loaded.config.challenge={id:chosen.id,backup:clone(config)};
  const errors=validateConfig(loaded.config);
  if (errors.length||!challengePartyValid(loaded.config)) throw Error('チャレンジの初期編成に失敗しました：'+errors.join('／'));
  return {config:loaded.config,selectedId:selectedA.id,challenge:chosen};
}
/** End the challenge and restore the saved pre-challenge formation unchanged. */
export function endChallenge(config) {
  const c=activeChallenge(config);
  if (!c) return clone(config);
  const original=config.challenge?.backup;
  if (!original || !Array.isArray(original.units) || !original.units.length)
    throw Error('元の編成を復元するための保存データがありません。');
  const restored=clone(original);
  delete restored.challenge;
  const errs=validateConfig(restored);
  if (errs.length) throw Error('保存済み編成の検証に失敗しました：'+errs.join('／'));
  return restored;
}
