// Shared detailed statistics presentation for local and official battle records.
// Null values mean "unverifiable from this source", not zero.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => n == null || !Number.isFinite(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('ja-JP');
const dec = n => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(1);
const percent = n => n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(1)}%`;
function metric(label,value,longLabel=label) {
    return `<div class="stat-metric" title="${esc(longLabel)}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
const nMetric = (label,value,desc=label) => metric(label,num(value),desc);
function group(title, metrics){return `<div class="stat-group"><h4>${esc(title)}</h4><div class="stat-metrics">${metrics.join('')}</div></div>`;}
const sumKnown = (a,b) => a == null || b == null ? null : Number(a)+Number(b);
function row(item) {
    const hits=item.hitRanks;
    const detail=[
      group('ダメージ',[
        nMetric('総与ダメージ',sumKnown(item.damageGivenHP,item.damageGivenAP),'敵へ与えたHPとAPの合計'),
        nMetric('総被ダメージ',sumKnown(item.damageTakenHP,item.damageTakenAP),'受けたHPとAPの合計'),
        nMetric('与ダメ(HP)',item.damageGivenHP,'敵へ与えたHPダメージ'),
        nMetric('与ダメ(AP)',item.damageGivenAP,'敵へ与えたAPダメージ'),
        nMetric('被ダメ(HP)',item.damageTakenHP,'受けたHPダメージ'),
        nMetric('被ダメ(AP)',item.damageTakenAP,'受けたAPダメージ'),
        metric('1T平均与ダメ(HP)',dec(item.avgDamageGivenHP)),metric('1T平均与ダメ(AP)',dec(item.avgDamageGivenAP)),
        metric('1T平均被ダメ(HP)',dec(item.avgDamageTakenHP)),metric('1T平均被ダメ(AP)',dec(item.avgDamageTakenAP)),
        nMetric('最大与ダメ(HP)',item.maxGivenHP,'1回の最大与HPダメージ'),
        nMetric('最大被ダメ(HP)',item.maxTakenHP,'1回の最大被HPダメージ')]),
      group('回復',[
        nMetric('総回復量(HP)',item.healGivenHP,'自身または味方へ実際に回復させたHP総量'),
        nMetric('総回復量(AP)',item.healGivenAP,'自身または味方へ実際に回復させたAP総量'),
        nMetric('被回復量(HP)',item.healReceivedHP,'自身が受けたHP回復の総量'),
        nMetric('被回復量(AP)',item.healReceivedAP,'自身が受けたAP回復の総量')]),
      group('攻撃・命中',[
        nMetric('攻撃回数',item.attacks,'攻撃行動を実行した回数'),
        nMetric('命中回数',item.hitLanded,'攻撃が回避されず命中した回数（複数対象は対象別）'),
        metric('命中率',percent(item.accuracyRate),'命中回数÷攻撃試行数'),
        nMetric('攻撃判定数',item.hitAttempts,'対象ごとに行った攻撃判定数')]),
      group('ヒット判定',['G','L','C','H','S'].map((k,i)=>
        metric(['グレイズ','ライト','クリーン','ハード','スマッシュ'][i],hits?.[k] == null ? '—' : `${num(hits[k])}回`,
          ['グレイズ','ライト','クリーン','ハード','スマッシュ'][i]+'の命中回数'))),
      group('回避・防御・抵抗',[
        nMetric('回避数',item.dodged,'敵の攻撃を回避した回数'),
        metric('回避率',percent(item.dodgeRate),'回避数÷受けた攻撃判定数'),
        nMetric('防御成功',item.defenseSuccess,'防御判定に成功した回数'),
        nMetric('防御失敗',item.defenseFailure,'防御判定に失敗した回数'),
        nMetric('抵抗成功',item.resistSuccess,'BSの抵抗判定に成功した回数'),
        nMetric('抵抗失敗',item.resistFailure,'BSの抵抗判定に失敗した回数')]),
      group('特殊判定・行動',[
        nMetric('CT回数',item.criticals,'1d100判定でクリティカルした回数'),
        nMetric('FB回数',item.fumbles,'1d100判定でファンブルした回数'),
        nMetric('BS付与成功回数',item.bsInflicted,'BS種別単位で付与に成功した回数'),
        nMetric('BS被付与回数',item.bsReceived,'BS種別単位で付与された回数'),
        nMetric('かばった回数',item.covered,'誰かへの攻撃をかばった回数'),
        nMetric('かばわれた回数',item.wasCovered,'誰かにかばわれた回数'),
        nMetric('ドラマ復活回数',item.drama,'ドラマ復活した回数'),
        metric('1d100出目平均',dec(item.diceAverage),'所属の特定できる1d100出目の平均'),
        nMetric('ダイスを振った回数',item.diceCount,'記録された1d100ダイスを振った回数'),
        nMetric('行動回数',item.actions,'行動を実行した回数'),
        nMetric('撃破数',item.defeats,'敵を戦闘不能にした回数')])
    ];
    return `<details class="unit-stats-detail"><summary class="unit-stats-summary"><span class="stat-team ${item.team==='B'?'enemy':''}">TEAM ${esc(item.team)}</span><strong>${esc(item.name)}</strong><span class="stat-summary-data">与ダメ(HP) ${num(item.damageGivenHP)} · 被ダメ(HP) ${num(item.damageTakenHP)}</span><span class="stat-chevron" aria-hidden="true">⌄</span></summary><div class="stat-full">${detail.join('')}</div></details>`;
}
export function renderCombatStatistics(items,turns,options={}) {
    if (!Array.isArray(items) || !items.length) return '';
    const sorted=[...items].sort((a,b)=>String(a.team).localeCompare(String(b.team))||String(a.name).localeCompare(String(b.name),'ja'));
    const title=options.title||'キャラ別・戦闘全体の統計';
    return `<details class="panel battle-stats-panel"><summary class="battle-stats-head"><strong>${esc(title)}</strong><span>${sorted.length}人 / ${num(turns)}T</span><span class="stat-chevron">⌄</span></summary><div class="battle-stats-body">${sorted.map(row).join('')}</div></details>`;
}
