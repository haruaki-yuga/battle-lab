import { arrangeInitialPositions } from './model.js?v=1.18.21';

/** Delete a character and prevent stale AI ID references from targeting a different character. */
export function deleteUnitSafely(config, id) {
    const removed = config.units.find(u => u.id === id);
    if (!removed) throw Error('削除対象が見つかりません。');
    if (config.units.filter(u => u.team === removed.team).length <= 1)
        throw Error('各チームに1人以上必要です。');
    config.units = config.units.filter(u => u.id !== id);
    let disabledRules = 0;
    for (const unit of config.units) {
        for (const rule of unit.rules || []) {
            let invalid = false;
            if (rule.target === 'id' && rule.targetUnitId === id) {
                rule.target = 'enemies'; rule.targetUnitId = ''; invalid = true;
            }
            if (rule.moveSubject === 'id' && rule.moveUnitId === id) {
                rule.moveSubject = 'enemies'; rule.moveUnitId = ''; invalid = true;
            }
            for (const condition of [...(rule.conditions || []), ...(rule.moveConditions || [])]) {
                if (condition?.type === 'who' && condition.subject === 'id' && condition.characterId === id) {
                    condition.subject = 'self'; condition.characterId = ''; invalid = true;
                }
            }
            if (invalid) { rule.enabled = false; disabledRules++; }
        }
    }
    arrangeInitialPositions(config.units);
    return {nextSelected: config.units[0].id, disabledRules};
}
