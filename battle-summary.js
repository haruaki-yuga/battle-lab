// Aggregate only opponent damage and clean-or-better hits by the attacking team.
// Keeping this separate from the UI makes mid-battle results and tests consistent.
export function teamBattleStats(units) {
  const result = {A: {damage: 0, cleanHits: 0}, B: {damage: 0, cleanHits: 0}};
  for (const unit of units) {
    const team = result[unit.team];
    if (!team) continue;
    team.damage += Math.max(0, Number(unit.damageDealt) || 0);
    team.cleanHits += Math.max(0, Number(unit.cleanHits) || 0);
  }
  return result;
}


// Apply the three independent tie-break votes only when ordinary combat
// has ended in a draw. An equal metric awards neither team a point.
export function scoreDraw(units) {
  const stats = teamBattleStats(units);
  const hp = {A: {remaining: 0, maximum: 0}, B: {remaining: 0, maximum: 0}};
  for (const unit of units) {
    const t = hp[unit.team];
    if (!t) continue;
    const max = Math.max(0, Number(unit.maxHp) || 0);
    t.maximum += max;
    t.remaining += Math.min(max, Math.max(0, Number(unit.hp) || 0));
  }
  const values = {
    A: {...stats.A, hpRatio: hp.A.maximum ? hp.A.remaining / hp.A.maximum : 0},
    B: {...stats.B, hpRatio: hp.B.maximum ? hp.B.remaining / hp.B.maximum : 0},
  };
  const points = {A: 0, B: 0};
  const votes = {};
  for (const key of ['damage', 'cleanHits', 'hpRatio']) {
    const difference = values.A[key] - values.B[key];
    const winner = Math.abs(difference) < 1e-10 ? null : difference > 0 ? 'A' : 'B';
    votes[key] = winner;
    if (winner) points[winner]++;
  }
  return {values, votes, points, winner: points.A === points.B ? 'draw' : points.A > points.B ? 'A' : 'B'};
}
