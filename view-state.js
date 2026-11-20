// Per-tab screen state. The formation itself remains in the existing localStorage key.
export const UI_STORAGE_KEY = 'arcadia-battle-lab-view-v1';
export const REPLAY_STORAGE_KEY = 'arcadia-battle-lab-replay-v1';
const PAGES = new Set(['setup', 'skills', 'rules', 'sim']);
const SORTS = new Set(['all', 'equipped', 'custom']);
const TYPES = new Set(['main', 'all', 'condition', 'damage', 'heal']);
const safeNumber = (value, fallback = 0, maximum = 1000000) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.min(maximum, Number(value))) : fallback;

export function readUiState(store, unitIds = []) {
    const initial = { page: 'setup', selected: unitIds[0] || '', scrollY: 0, frame: -1,
        selectedLogId: -1, logScrollTop: null, logType: 'main', logTurn: 'all', logSearch: '',
        skillSearch: '', kindFilter: 'all', skillFilter: 'all', skillPage: 0 };
    try {
        const state = JSON.parse(store?.getItem(UI_STORAGE_KEY) || 'null');
        if (!state || state.version !== 1) return initial;
        return {
            ...initial,
            page: PAGES.has(state.page) ? state.page : initial.page,
            selected: unitIds.includes(state.selected) ? state.selected : initial.selected,
            scrollY: safeNumber(state.scrollY, 0, 10000000),
            frame: Number.isInteger(state.frame) ? Math.max(-1, Math.min(300000, state.frame)) : -1,
            selectedLogId: Number.isInteger(state.selectedLogId) ? state.selectedLogId : -1,
            logScrollTop: state.logScrollTop === null ? null : safeNumber(state.logScrollTop, 0, 10000000),
            logType: TYPES.has(state.logType) ? state.logType : initial.logType,
            logTurn: state.logTurn === 'all' || (Number.isInteger(state.logTurn) && state.logTurn >= 1 && state.logTurn <= 25) ? state.logTurn : 'all',
            logSearch: typeof state.logSearch === 'string' ? state.logSearch.slice(0, 500) : '',
            skillSearch: typeof state.skillSearch === 'string' ? state.skillSearch.slice(0, 500) : '',
            kindFilter: typeof state.kindFilter === 'string' ? state.kindFilter.slice(0, 40) : 'all',
            skillFilter: SORTS.has(state.skillFilter) ? state.skillFilter : 'all',
            skillPage: safeNumber(state.skillPage, 0, 1000)
        };
    } catch { return initial; }
}
export function writeUiState(store, state) {
    try { store?.setItem(UI_STORAGE_KEY, JSON.stringify({ version: 1, ...state })); return true; }
    catch { return false; }
}
// Replay is reproducible by its original seed; do not serialize the in-memory
// Battle instance, especially its random closure and Map of skills.
export function writeReplayState(store, sim) {
    try {
        if (!store) return false;
        if (!sim || sim.turn < 1) { store.removeItem(REPLAY_STORAGE_KEY); return true; }
        store.setItem(REPLAY_STORAGE_KEY, JSON.stringify({
            version: 1, seed: sim.seed, turns: sim.turn, config: sim.config
        }));
        return true;
    } catch { return false; }
}
export function readReplayState(store, BattleClass) {
    try {
        const snapshot = JSON.parse(store?.getItem(REPLAY_STORAGE_KEY) || 'null');
        if (!snapshot || snapshot.version !== 1 || !snapshot.config ||
            typeof snapshot.seed !== 'string' || snapshot.seed.length > 200 ||
            !Number.isInteger(snapshot.turns) || snapshot.turns < 1 || snapshot.turns > 25)
            return null;
        const sim = new BattleClass(snapshot.config, snapshot.seed);
        for (let i = 0; i < snapshot.turns && !sim.done; i++) sim.stepTurn();
        return sim.turn === snapshot.turns ? sim : null;
    } catch { return null; }
}
