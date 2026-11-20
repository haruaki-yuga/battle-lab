// Compact collapsible per-character summary built from engine event counters.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Math.round(Number(n)||0).toLocaleString('ja-JP');
const dec = n => Number.isFinite(n) ? Number(n).toFixed(1) : '—';
const percent = n => Number.isFinite(n) ? `${Number(n).toFixed(1)}%` : '—';
function metric(label,value,longLabel=label) {
    return `<div class="stat-metric" title="${esc(longLabel)}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function group(title,metrics){return `<div class="stat-group"><h4>${esc(title)}</h4><div class="stat-metrics">${metrics.join('')}</div></div>`;}
function row(item) {
    const hits=item.hitRanks||{};
    const hitsLabel=['G','L','C','H','S'].map(k=>`${k}${num(hits[k])}`).join('：');
    const primary=[metric('与HP',num(item.damageGivenHP),'相手へ与えたHPダメージ'),metric('被HP',num(item.damageTakenHP),'受けたHPダメージ'),
        metric('与AP',num(item.damageGivenAP),'相手へ与えたAPダメージ'),metric('被AP',num(item.damageTakenAP),'受けたAPダメージ')];
    const detail=[
      group('ダメージ',[
        metric('与HP/T',dec(item.avgDamageGivenHP),'1ターン平均与HPダメージ'),metric('被HP/T',dec(item.avgDamageTakenHP),'1ターン平均被HPダメージ'),
        metric('与AP/T',dec(item.avgDamageGivenAP),'1ターン平均与APダメージ'),metric('被AP/T',dec(item.avgDamageTakenAP),'1ターン平均被APダメージ'),
        metric('最大与HP',num(item.maxGivenHP),'1回の最大与HPダメージ'),metric('最大被HP',num(item.maxTakenHP),'1回の最大被HPダメージ')]),
      group('攻撃・命中',[
        metric('攻撃',num(item.attacks),'攻撃スキルを仕掛けた回数'),metric('命中',num(item.hitLanded),'攻撃が回避されずに成立した回数'),
        metric('命中率',percent(item.accuracyRate),'命中回数÷対象への攻撃試行数'),metric('ヒット段階',hitsLabel,'G:グレイズ L:ライト C:クリーン H:ハード S:スマッシュ')]),
      group('回復・防御',[
        metric('回HP',num(item.healGivenHP),'自分・味方を回復させたHP総量'),metric('回AP',num(item.healGivenAP),'自分・味方を回復させたAP総量'),
        metric('回復数',num(item.healCount),'実際に回復量が発生した回数'),metric('回避',num(item.dodged),'敵の攻撃を回避した回数'),
        metric('回避率',percent(item.dodgeRate),'回避数÷受けた攻撃試行数'),metric('防成',num(item.defenseSuccess),'防御判定に成功した回数'),
        metric('防失',num(item.defenseFailure),'防御判定に失敗した回数')]),
      group('特殊判定・行動',[
        metric('CT',num(item.criticals),'1d100判定でクリティカルした回数'),metric('FB',num(item.fumbles),'1d100判定でファンブルした回数'),
        metric('BS付',num(item.bsInflicted),'BSの付与に成功した件数'),metric('BS被',num(item.bsReceived),'BSを付与された件数'),
        metric('庇護',num(item.covered),'誰かを庇って攻撃を引き受けた回数'),metric('被庇',num(item.wasCovered),'誰かに庇われた回数'),
        metric('ドラマ',num(item.drama),'ドラマ復活回数'),metric('出目平均',dec(item.diceAverage),'帰属を特定できる1d100の出目平均'),
        metric('骰数',num(item.diceCount),'集計対象になった1d100の数'),metric('行動',num(item.actions),'実行した行動回数'),metric('撃破',num(item.defeats),'相手を戦闘不能にした回数')])
    ];
    return `<details class="unit-stats-detail"><summary class="unit-stats-summary"><span class="stat-team ${item.team==='B'?'enemy':''}">TEAM ${esc(item.team)}</span><strong>${esc(item.name)}</strong><span class="stat-summary-data">与HP ${num(item.damageGivenHP)} · 被HP ${num(item.damageTakenHP)}</span><span class="stat-chevron" aria-hidden="true">⌄</span></summary><div class="stat-primary">${primary.join('')}</div><div class="stat-full">${detail.join('')}</div></details>`;
}
export function renderCombatStatistics(items,turns) {
    if (!Array.isArray(items) || !items.length) return '';
    const sorted=[...items].sort((a,b)=>String(a.team).localeCompare(String(b.team))||String(a.name).localeCompare(String(b.name),'ja'));
    return `<details class="panel battle-stats-panel"><summary class="battle-stats-head"><strong>キャラ別・戦闘全体の統計</strong><span>${sorted.length}人 / ${num(turns)}T</span><span class="stat-chevron">⌄</span></summary><div class="battle-stats-body">${sorted.map(row).join('')}<p class="footnote">HP/APダメージは実際に障壁を抜けた値です。与ダメージは相手チームへの効果のみ集計し、1T平均は経過ターン数で除算します。命中段階は G（グレイズ）/L（ライト）/C（クリーン）/H（ハード）/S（スマッシュ）です。CT/FBは行使・回避・防御・BS抵抗などの1d100を集計し、出目平均も帰属先が判明した1d100のみを対象とします。</p></div></details>`;
}
