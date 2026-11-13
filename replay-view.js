// View-only helpers: keep the battle engine's frame/log data unchanged.
export function replayActorId(logs, frames, frameIndex, selectedLogId = -1) {
    const shown = frames?.[frameIndex];
    if (!shown)
        return null;
    const available = new Set((shown.units || []).map(unit => unit.id));
    if (selectedLogId !== -1) {
        const selected = logs.find(log => log.id === selectedLogId);
        // An end-of-turn, result, or other actor-less log has no "acting unit".
        return selected?.frameIndex === frameIndex && available.has(selected.actor) ? selected.actor : null;
    }
    // Slider navigation: choose the actor of an action logged at this exact frame.
    const candidate = [...logs].reverse().find(log => log.frameIndex === frameIndex && log.actor && log.type !== 'speed' && available.has(log.actor));
    return candidate?.actor || null;
}
export function groupReplayUnitsByTeam(units) {
    return ['A', 'B'].map(team => ({ team, units: units.filter(unit => unit.team === team) }));
}
