// Detailed per-character battle statistics. Values are collected at the combat
// resolution points, not estimated from translated log text.
export const HIT_RANK_KEYS = ['G', 'L', 'C', 'H', 'S'];
export function freshBattleStatistics(unit) {
    return {
        id: unit.id, name: unit.name, team: unit.team,
        damageGivenHP: 0, damageGivenAP: 0, damageTakenHP: 0, damageTakenAP: 0,
        healGivenHP: 0, healGivenAP: 0, healCount: 0,
        attacks: 0, hitAttempts: 0, hitLanded: 0,
        hitRanks: { G: 0, L: 0, C: 0, H: 0, S: 0 },
        dodged: 0, incomingAttempts: 0, criticals: 0, fumbles: 0,
        bsInflicted: 0, bsReceived: 0,
        defenseSuccess: 0, defenseFailure: 0,
        covered: 0, wasCovered: 0, drama: 0,
        diceSum: 0, diceCount: 0,
        maxGivenHP: 0, maxTakenHP: 0, actions: 0, defeats: 0
    };
}
export function finishBattleStatistics(statistics, turns) {
    const divisor = Math.max(1, Number(turns) || 1);
    return [...statistics.values()].map(row => ({
        ...row,
        hitRanks: { ...row.hitRanks },
        avgDamageGivenHP: row.damageGivenHP / divisor,
        avgDamageGivenAP: row.damageGivenAP / divisor,
        avgDamageTakenHP: row.damageTakenHP / divisor,
        avgDamageTakenAP: row.damageTakenAP / divisor,
        accuracyRate: row.hitAttempts ? row.hitLanded / row.hitAttempts * 100 : null,
        dodgeRate: row.incomingAttempts ? row.dodged / row.incomingAttempts * 100 : null,
        diceAverage: row.diceCount ? row.diceSum / row.diceCount : null,
        measuredTurns: turns
    }));
}
