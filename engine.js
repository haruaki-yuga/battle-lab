import { normalizeSettings, runSeed } from './run-settings.js';
import { clone, validateConfig, BS_GROUPS, BS_NAMES, STAT_LABELS, EFFECTS, targetCriteriaForRule } from './model.js';
import { scoreDraw } from './battle-summary.js';
import { selectDiskDestination } from './movement-disk.js';
import { bsLogLabel } from './combat-log-format.js';
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function seededRandom(seed) {
    let h = 2166136261;
    for (const c of String(seed))
        h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h += 0x6D2B79F5;
        let t = Math.imul(h ^ h >>> 15, 1 | h);
        t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
// One offensive accuracy roll is shared by everyone caught in a multi-target attack.
// Target-specific evasion, hit-rate and defense checks still resolve separately.
const MULTI_TARGET_ATTACK_SCOPES = new Set([
    'area',
    'wide',
    'selfArea',
    'selfWide',
    'pierce',
    'cone',
    'line',
    'special'
]);
const normalSkill = u => ({
    id: 'normal',
    name: '通常攻撃',
    kind: 'attack',
    trigger: 'instant',
    cost: 50,
    ap: 0,
    range: u.normalRange || 'near',
    scope: 'single',
    mainPct: 100,
    subPct: 100,
    mainBonus: 0,
    subBonus: 0,
    hitBonus: 0,
    effects: {},
    bs: [],
    castMods: {}
});
const sumBuff = (items, key) => Math.max(0, ...items.map(x => Number(x[key] || 0))) + items.reduce((a, x) => a + Math.min(0, Number(x[key] || 0)), 0);
export function effectiveBS(entries) {
    const counts = {};
    for (const b of entries)
        if (b.remaining > 0)
            counts[b.name] = (counts[b.name] || 0) + 1;
    const active = new Set(Object.keys(counts));
    for (const group of BS_GROUPS) {
        const input = group.map(b => counts[b] || 0);
        if (!input.some(Boolean))
            continue;
        const solve = (i, carry) => {
            if (i === group.length)
                return { score: 0, on: [] };
            const n = input[i] + carry;
            let best = { score: -1, on: [] };
            for (let promoted = 0; promoted <= (i === group.length - 1 ? 0 : Math.floor(n / 4)); promoted++) {
                const rest = n - 4 * promoted;
                const next = solve(i + 1, promoted);
                const score = next.score + (rest > 0 ? i + 1 : 0);
                if (score > best.score)
                    best = { score, on: [...(rest > 0 ? [group[i]] : []), ...next.on] };
            }
            return best;
        };
        group.forEach(n => active.delete(n));
        solve(0, 0).on.forEach(n => active.add(n));
    }
    return active;
}
export function rangeInfo(skill, d, policy = 'text', versatile = false) {
    // All healing skills (HP/AP/HP+AP/BS) have 万能 inherently. This is a
    // combat rule, not an optional effect stored in individual skill JSON.
    const universal = versatile || ['hp', 'ap', 'ha', 'cleanse'].includes(skill.kind);
    let max = {
        touch: 3,
        near: 10,
        mid: 20,
        far: 30,
        super: 40,
        special: Number(skill.customRange || 20)
    }[skill.range] ?? 10;
    if (['self', 'selfArea', 'selfWide'].includes(skill.scope))
        return { valid: true, bonus: 0, max: skill.scope === 'selfWide' ? 10 : skill.scope === 'selfArea' ? 5 : 0 };
    const valid = d <= max + 1e-6 && (skill.range !== 'super' || d > 10 || universal);
    let bonus = 0;
    if (skill.range === 'touch')
        bonus = 15;
    if (skill.range === 'near')
        bonus = 10;
    if (skill.range === 'mid')
        bonus = d <= 10 ? 7 : 10;
    if (skill.range === 'far')
        bonus = d <= 3 ? -10 : d <= 10 ? -5 : d <= 20 ? 5 : 10;
    if (skill.range === 'super')
        bonus = d <= 20 ? -5 : d <= 30 ? 5 : 10;
    if (universal)
        bonus = Math.max(0, bonus);
    if (skill.kind !== 'attack')
        bonus = 0;
    return { valid, bonus, max };
}
export class Battle {
    constructor(config, seed, { quiet = false } = {}) {
        const errors = validateConfig(config);
        if (errors.length)
            throw Error(errors.join('\n'));
        seed = runSeed(config, seed);
        this.config = normalizeSettings(clone(config));
        this.random = seededRandom(seed);
        this.seed = seed;
        this.turn = 0;
        this.gauge = 0;
        this.events = [];
        this.logs = [];
        this.frames = [];
        this.done = false;
        this.winner = null;
        this.tiebreak = null;
        this.quiet = quiet;
        this.seq = 0;
        this.processed = 0;
        this.warnings = [];
        this.skills = new Map(config.skills.map(s => [s.id, clone(s)]));
        this.units = config.units.map(u => ({
            ...clone(u),
            hp: u.maxHp * u.startHp / 100,
            ap: u.maxAp * u.startAp / 100,
            av: 0,
            carry: 0,
            actions: 0,
            totalActions: 0,
            damageDealt: 0,
            healing: 0,
            hits: 0,
            cleanHits: 0,
            alive: u.startHp > 0,
            ctLoss: 0,
            luckLoss: 0,
            evadeLoss: 0,
            dramaCount: 0,
            focusA: false,
            focusD: false,
            pending: false,
            waiting: false,
            carrying: false,
            afterWait: false,
            waitCount: 0,
            coverId: null,
            blockId: null,
            distanceMoved: 0,
            movementAvSpent: 0,
            incomingHits: 0,
            damageTaken: 0,
            outOfRangeFails: 0,
            intercepts: [],
            retaliations: [],
            buffs: [],
            bs: (u.initialBS || []).map(name => ({ name, remaining: 3, source: u.id })),
            doneTurn: false
        }));
        for (const u of this.units) {
            u.hp = Math.floor(this.stat(u, 'maxHp') * u.startHp / 100);
            u.ap = Math.floor(this.stat(u, 'maxAp') * u.startAp / 100);
        }
        this.snapshot('初期配置');
    }
    d(sides = 100) {
        return 1 + Math.floor(this.random() * sides);
    }
    get(id) {
        return this.units.find(u => u.id === id);
    }
    skillFor(u, id) {
        const skill = this.skills.get(id);
        if (!skill)
            return null;
        const alias = u?.skillAliases?.[id];
        return alias && alias !== skill.name ? { ...skill, name: alias } : skill;
    }
    statuses(u) {
        return effectiveBS(u.bs);
    }
    stat(u, key) {
        let n = Number(u[key] || 0);
        const bs = this.statuses(u);
        if (!bs.has('無策'))
            n += sumBuff(u.buffs.map(b => b.modifiers || {}), key);
        const drama = Math.min(5, u.dramaCount);
        if (['main', 'sub', 'speed'].includes(key))
            n += 40 * drama;
        if (key === 'critical')
            n += 2 * drama;
        if (u.focusA && key === 'hit')
            n += 10;
        if (u.focusD && ['evade', 'defense', 'resist'].includes(key))
            n += 5;
        const ease = this.effectRaw(u, 'bsEase');
        const strength = (gi) => {
            const g = BS_GROUPS[gi];
            return [...bs].filter(b => g.includes(b)).reduce((a, b) => a + Math.max(1, g.indexOf(b) + 1 - ease), 0);
        };
        const frozen = strength(2);
        if (['hit', 'evade'].includes(key))
            n -= frozen * 3 + (bs.has('暗闇') ? 10 : 0);
        if (key === 'speed')
            n -= frozen * 16;
        if (key === 'resist')
            n -= strength(3) * 10;
        if (key === 'defense')
            n -= strength(4) * 10;
        if (key === 'mobility')
            n -= strength(7);
        if (key === 'drama')
            n -= strength(8) * 10;
        for (const b of bs) {
            const i = BS_GROUPS[9].indexOf(b), j = BS_GROUPS[10].indexOf(b);
            if (key === 'critical' && i >= 0)
                n -= [5, 8, 10, 13][Math.max(0, i - ease)];
            if (key === 'fumble' && j >= 0)
                n += [5, 8, 10, 13][Math.max(0, j - ease)];
        }
        // Each sudden-death round adds five CT and five FB points cumulatively.
        if (key === 'critical' || key === 'fumble')
            n += this.suddenRound() * 5;
        if (key === 'critical')
            n -= Math.min(Math.max(0, n / 2), u.ctLoss);
        if (key === 'evade')
            n -= u.evadeLoss;
        if (['maxHp', 'maxAp', 'mobility', 'fumble'].includes(key))
            n = Math.max(key === 'maxHp' ? 1 : 0, n);
        return n;
    }
    effectRaw(u, key) {
        let n = Number(u.effects?.[key] || 0);
        if (!u.bs.some(b => b.name === '無策'))
            n += sumBuff(u.buffs.map(b => b.effects || {}), key);
        return n;
    }
    effect(u, skill, key) {
        return this.effectRaw(u, key) + Number(skill?.effects?.[key] || 0);
    }
    suddenRound() {
        return Math.max(0, Math.min(5, this.turn - 20));
    }
    damageAmount(value, exempt = false) {
        const base = Math.max(0, Math.floor(value));
        // The five sudden-death rounds increase incoming damage additively:
        // +30%, +60%, +90%, +120%, +150%. The opening HP tax is exempt.
        return exempt ? base : Math.floor(base * (1 + this.suddenRound() * .3) + 1e-8);
    }
    roll(u, mods = {}, commit = true) {
        const die = this.d(), fb = Math.max(0, this.stat(u, 'fumble') + Number(mods.fumble || 0));
        const ct = this.stat(u, 'critical') + Number(mods.critical || 0);
        const fumble = die <= fb, critical = !fumble && die >= 100 - ct;
        if (critical && commit) {
            u.ctLoss += 10;
            u.luckLoss++;
        }
        return {
            die,
            fumble,
            critical,
            fb,
            ct
        };
    }
    log(type, message, detail = '', actor = null, target = null, tags = []) {
        if (this.quiet)
            return;
        const frameIndex = this.snapshot(message);
        this.logs.push({
            id: this.logs.length,
            turn: this.turn,
            gauge: this.gauge,
            type,
            message,
            detail,
            actor: actor?.id || null,
            target: target?.id || null,
            frameIndex,
            tags
        });
    }
    snapshot(label) {
        if (this.quiet)
            return -1;
        const units = this.units.map(u => ({
            id: u.id,
            name: u.name,
            team: u.team,
            x: u.x,
            y: u.y,
            hp: u.hp,
            maxHp: this.stat(u, 'maxHp'),
            ap: u.ap,
            maxAp: this.stat(u, 'maxAp'),
            av: u.av,
            alive: u.alive,
            bs: u.bs.map(b => ({ ...b })),
            damageDealt: u.damageDealt,
            healing: u.healing,
            actions: u.totalActions
        }));
        const signature = JSON.stringify([this.turn, units]);
        if (signature === this._lastFrameSignature)
            return this.frames.length - 1;
        this._lastFrameSignature = signature;
        this.frames.push({ turn: this.turn, label, units });
        return this.frames.length - 1;
    }
    resolveDraw(reason) {
        // Use effective maximum HP at the actual end of battle (including buffs).
        this.tiebreak = scoreDraw(this.units.map(u => ({ ...u, maxHp: this.stat(u, 'maxHp') })));
        this.done = true;
        this.winner = this.tiebreak.winner;
        const { points, votes, values } = this.tiebreak;
        const metric = (key, label, display) => `${label} ${display(values.A[key])}：${display(values.B[key])}（${votes[key] ? `TEAM ${votes[key]} +1` : '同点'}）`;
        const detail = [
            metric('damage', '与ダメ', n => Math.floor(n).toLocaleString()),
            metric('cleanHits', 'クリーンヒット以上', String),
            metric('hpRatio', '残HP割合', n => (n * 100).toFixed(2) + '%')
        ].join(' / ');
        this.log('result', `${reason} → 判定 ${points.A}対${points.B}：${this.winner === 'draw' ? '引き分け' : `TEAM ${this.winner} 勝利`}`, detail, null, null, [{ kind: 'result', label: `判定 ${points.A} - ${points.B}` }]);
    }
    checkEnd() {
        const a = this.units.some(u => u.team === 'A' && u.alive), b = this.units.some(u => u.team === 'B' && u.alive);
        if (!a || !b) {
            if (!a && !b)
                this.resolveDraw('両陣営が戦闘不能');
            else {
                this.done = true;
                this.winner = a ? 'A' : 'B';
                this.log('result', `チーム${this.winner}の勝利`);
            }
            return true;
        }
        return false;
    }
    heal(u, value, type, source = null) {
        if (!u.alive)
            return 0;
        if (type === 'hp' && this.statuses(u).has('致命')) {
            this.log('heal', `${u.name}のHP回復は致命により無効`);
            return 0;
        }
        const max = this.stat(u, type === 'hp' ? 'maxHp' : 'maxAp'), old = u[type];
        u[type] = Math.max(old, Math.min(max, Math.max(0, u[type] + Math.max(0, Math.floor(value)))));
        const gain = u[type] - old;
        if (source)
            source.healing += gain;
        return gain;
    }
    hurt(u, value, source = null, dramaPenalty = 0, lethal = 0, onDamageResolved = null, suddenExempt = false) {
        if (!u.alive)
            return 0;
        const n = this.damageAmount(value, suddenExempt), actual = Math.min(Math.max(0, u.hp), n);
        u.hp -= n;
        if (source && source.team !== u.team) {
            source.damageDealt += n;
            u.damageTaken += n;
        }
        let outcome = null;
        if (u.hp <= 0) {
            const d = this.d(), target = 100 - (this.stat(u, 'drama') / (1 + Math.max(0, lethal)) - dramaPenalty);
            if (d >= target) {
                u.hp = 1;
                u.dramaCount++;
                outcome = {
                    type: 'drama',
                    message: `${u.name}はドラマで踏みとどまった`,
                    detail: `${d} ≥ ${target.toFixed(1)} / HP 1`,
                    actor: u,
                    target: null
                };
            }
            else {
                u.hp = 0;
                u.alive = false;
                u.pending = false;
                u.doneTurn = true;
                outcome = {
                    type: 'down',
                    message: `${u.name}が戦闘不能`,
                    detail: `ドラマ判定 ${d} < ${target.toFixed(1)}`,
                    actor: source,
                    target: u
                };
            }
        }
        // Record the damage first, then the resulting drama/down event in the battle log.
        // The snapshot for each log already reflects the resolved HP/alive state.
        if (onDamageResolved)
            onDamageResolved(n);
        if (outcome)
            this.log(outcome.type, outcome.message, outcome.detail, outcome.actor, outcome.target);
        return actual;
    }
    pool(subject, u, previous = []) {
        if (subject === 'self')
            return [u];
        if (subject === 'previous')
            return previous;
        return this.units.filter(t => subject === 'all' || subject === 'allies' && t.team === u.team || subject === 'companions' && t.team === u.team && t.id !== u.id || subject === 'enemies' && t.team !== u.team);
    }
    metric(t, key, u, c) {
        const hpMax = this.stat(t, 'maxHp'), apMax = this.stat(t, 'maxAp'), bs = t.bs.filter(b => !(c.bs?.length) || c.bs.includes(b.name));
        const m = {
            alive: t.alive,
            actions: t.actions,
            av: t.av,
            avDiff: u.av - t.av,
            active: t.pending,
            waiting: t.waiting,
            carrying: t.carrying,
            hp: t.hp,
            hpPct: t.hp / hpMax * 100,
            damage: hpMax - t.hp,
            damagePct: (hpMax - t.hp) / hpMax * 100,
            ap: t.ap,
            apPct: apMax ? t.ap / apMax * 100 : 0,
            apLoss: apMax - t.ap,
            apLossPct: apMax ? (apMax - t.ap) / apMax * 100 : 0,
            bsCount: bs.length,
            bsTypes: new Set(bs.map(b => b.name)).size,
            buffCount: t.buffs.reduce((a, b) => a + Object.keys(b.modifiers || {}).length + Object.keys(b.effects || {}).length, 0),
            buffTypes: new Set(t.buffs.flatMap(b => [...Object.keys(b.modifiers || {}), ...Object.keys(b.effects || {})])).size,
            luckLoss: t.luckLoss,
            intercept: t.intercepts.length,
            retaliate: t.retaliations.length,
            counterTotal: t.intercepts.length + t.retaliations.length,
            coverers: this.units.filter(v => v.id !== t.id && v.alive && v.team === t.team && distance(v, t) <= 3).length,
            distance: distance(u, t)
        };
        return key in m ? m[key] : this.stat(t, key);
    }
    conditions(u, conditions, initial = []) {
        let previous = initial;
        for (const c of conditions) {
            let ok = false;
            if (c.type === 'who') {
                previous = this.pool(c.subject, u, previous).filter(t => {
                    const v = this.metric(t, c.metric, u, c);
                    const match = typeof v === 'boolean' ? v : v >= c.min && v <= c.max;
                    return c.not ? !match : match;
                });
                ok = previous.length > 0;
            }
            else if (c.type === 'turn') {
                ok = this.turn >= c.offset && (this.turn - c.offset) % Math.max(1, c.multiple) === 0;
                ok = c.not ? !ok : ok;
            }
            else if (c.type === 'afterWait') {
                ok = c.not ? !u.afterWait : u.afterWait;
            }
            else if (c.type === 'chance') {
                ok = this.random() * 100 < c.chance;
                ok = c.not ? !ok : ok;
            }
            if (!ok)
                return { ok: false, targets: previous };
        }
        return { ok: true, targets: previous };
    }
    // Select a movement reference independently from the action target.
    // For legacy rules, no separate reference is used and combat remains unchanged.
    movementTargets(u, r, previous) {
        if (!r.splitMovement || r.moveTargetMode !== 'individual')
            return null;
        let candidates = r.moveSubject === 'id' ? [this.get(r.moveUnitId)].filter(Boolean) : this.pool(r.moveSubject || 'previous', u, previous);
        candidates = candidates.filter(t => t.alive);
        if (r.moveConditions?.length) {
            const check = this.conditions(u, r.moveConditions, candidates);
            if (!check.ok)
                return [];
            if (r.moveConditions.some(c => c.type === 'who')) {
                const ids = new Set(check.targets.map(t => t.id));
                candidates = candidates.filter(t => ids.has(t.id));
            }
        }
        return this.sortTargets(u, candidates, r.moveSort || 'nearest');
    }
    // Per-target filters are independent from the rule's IF conditions: the
    // selected candidate itself must satisfy every additional condition.
    targetMatches(u, t, conditions = []) {
        return conditions.every(c => {
            const value = this.metric(t, c.metric, u, c);
            const match = typeof value === 'boolean' ? value : value >= c.min && value <= c.max;
            return c.not ? !match : match;
        });
    }
    sortTargets(u, candidates, key = 'nearest') {
        const keys = Array.isArray(key) ? key : key ? [key] : ['nearest'];
        const val = (t, k) => this.metric(t, k, u, {});
        const base = {
            nearest: t => distance(u, t),
            farthest: t => -distance(u, t),
            acting: t => t.pending ? -1 : 0,
            waiting: t => t.waiting ? -1 : 0,
            carrying: t => t.carrying ? -1 : 0,
            hp: t => t.hp,
            hpHigh: t => -t.hp,
            damageMin: t => val(t, 'damage'),
            damageMax: t => -val(t, 'damage'),
            ap: t => t.ap,
            apHigh: t => -t.ap,
            apLossMin: t => val(t, 'apLoss'),
            apLossMax: t => -val(t, 'apLoss'),
            hpPct: t => val(t, 'hpPct'),
            apPct: t => val(t, 'apPct'),
            bs: t => -t.bs.length,
            main: t => -this.stat(t, 'main')
        };
        // A random sort key is generated once per candidate per selection, not during comparison.
        const rolls = new Map();
        if (keys.includes('random'))
            for (const t of candidates)
                rolls.set(t.id, this.random());
        const score = (t, k) => k === 'random' ? rolls.get(t.id) : base[k] ? base[k](t) :
            k.endsWith('Min') ? this.stat(t, k.slice(0, -3)) :
                k.endsWith('Max') ? -this.stat(t, k.slice(0, -3)) : distance(u, t);
        return candidates.sort((a, b) => {
            for (const k of keys) {
                const diff = score(a, k) - score(b, k);
                if (diff)
                    return diff;
            }
            return distance(u, a) - distance(u, b) || a.id.localeCompare(b.id);
        });
    }
    targets(u, r, previous) {
        const rules = targetCriteriaForRule(r);
        const filters = rules.filter(q => q.type === 'filter');
        const priorities = rules.filter(q => q.type === 'sort').map(q => q.sort);
        const candidates = this.pool(r.target, u, previous).filter(t => t.alive && this.targetMatches(u, t, filters));
        return this.sortTargets(u, candidates, priorities.length ? priorities : ['nearest']);
    }
    movePlan(u, target, r, skill, capacityOverride = null) {
        if (!r.autoMove && r.action !== 'move')
            return null;
        if (!target || target.id === u.id)
            return null;
        const capacity = capacityOverride ?? this.stat(u, 'mobility') * 10;
        if (capacity <= 0)
            return null;
        const half = this.config.settings.mapSize / 2;
        const blockers = this.units.filter(b => b.alive && b.blockId === u.id && distance(b, u) <= 3);
        return selectDiskDestination(u, target, capacity, half, {
            mode: r.moveMode === 'kite' ? 'fixed' : r.moveMode,
            minDist: r.minDist,
            maxDist: r.maxDist,
            moveOnly: r.action === 'move',
            blocked: p => blockers.some(b => distance(b, p) <= distance(b, u) + .001)
        });
    }
    // Keep a ranged firing lane, with a sideways escape when the map boundary
    // prevents a straight retreat. Uses the same movement budget/range as other AI.
    kiteMovePlan(u, target, r, capacity) {
        const maxD = Math.max(1, Number(r.maxDist) || 28), minD = Math.max(0, Math.min(maxD, Number(r.minDist) || 0));
        const desired = Math.max(minD, Math.min(29.5, maxD));
        const d = distance(u, target);
        if (d >= desired - .35 && d <= maxD + .35)
            return null;
        const half = this.config.settings.mapSize / 2;
        const blockers = this.units.filter(b => b.alive && b.blockId === u.id && distance(b, u) <= 3);
        const threats = this.units.filter(t => t.alive && t.team !== u.team);
        const base = Math.atan2(u.y - target.y, u.x - target.x);
        let best = null;
        // Find a destination on the desired firing circle. Clamp movement to the
        // character's mobility, not the radius. Testing all bearings allows strafing.
        for (let i = 0; i < 72; i++) {
            const theta = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 36;
            const goal = { x: target.x + Math.cos(theta) * desired, y: target.y + Math.sin(theta) * desired };
            if (Math.abs(goal.x) > half + 1e-8 || Math.abs(goal.y) > half + 1e-8)
                continue;
            const length = distance(u, goal);
            if (length < .001)
                continue;
            const fraction = Math.min(1, capacity / length);
            const pos = { x: u.x + (goal.x - u.x) * fraction, y: u.y + (goal.y - u.y) * fraction };
            const achieved = distance(pos, target), progress = Math.abs(d - desired) - Math.abs(achieved - desired);
            if (progress < .005)
                continue;
            if (blockers.some(b => distance(b, pos) <= distance(b, u) + .001))
                continue;
            const safety = threats.length ? Math.min(...threats.map(t => distance(pos, t))) : achieved;
            // Prefer reaching the target range, then distance from *all* enemies.
            const score = Math.abs(achieved - desired) * 12 + Math.max(0, desired - safety) * .12 + distance(u, pos) * .003;
            if (!best || score < best.score)
                best = { ...pos, score };
        }
        return best ? { x: best.x, y: best.y } : null;
    }
    apCost(u, s) {
        return Math.max(0, Math.floor((s.ap || 0) * (1 - clamp(this.effect(u, s, 'efficiency'), 0, 100) / 100)));
    }
    // Movement extension: after the normal mobility × 10m position, only when
    // the action is still out of range may 10m steps (at most 30m) be added.
    // The marginal AV costs are 10, 15, 20 => accumulated 10, 25, 45.
    extraMovementCost(steps) {
        return [0, 10, 25, 45][steps] ?? 45;
    }
    positionForAction(u, reference, r, skill, actionTarget) {
        const capacity = this.stat(u, 'mobility') * 10;
        const base = this.movePlan(u, reference, r, skill, capacity);
        const response = { move: base, extraSteps: 0, moveCost: base ? (this.config.settings.moveCost || 40) : 0 };
        if (!skill || skill.trigger !== 'instant' || !r.autoMove || !actionTarget || !actionTarget.alive)
            return response;
        const validAt = position => rangeInfo(skill, distance(position || u, actionTarget), this.config.settings.rangePolicy, this.effect(u, skill, 'versatile') > 0).valid;
        if (validAt(base))
            return response;
        const range = rangeInfo(skill, 0, this.config.settings.rangePolicy, this.effect(u, skill, 'versatile') > 0).max;
        const min = skill.range === 'super' && this.effect(u, skill, 'versatile') <= 0 ? 10 + 1e-5 : 0;
        const gap = position => {
            const d = distance(position || u, actionTarget);
            return d > range ? d - range : d < min ? min - d : 0;
        };
        let best = response, bestGap = gap(base);
        for (let steps = 1; steps <= 3; steps++) {
            const cost = (this.config.settings.moveCost || 40) + this.extraMovementCost(steps);
            if (u.av < cost)
                break;
            const candidates = [this.movePlan(u, reference, r, skill, capacity + 10 * steps)];
            // A fixed-distance band may itself lie outside the skill range. Once the
            // normal position is reached, the additional movement can close the gap.
            // This is still one of the three positioning modes, not a new mode.
            if (['fixed', 'kite'].includes(r.moveMode)) {
                const origin = base || u, d = distance(origin, actionTarget);
                if (d > range + 1e-6 || d < min) {
                    const direction = d > range ? 1 : -1;
                    const gapDistance = d > range ? d - range : Math.max(0, min - d);
                    const extension = Math.min(10 * steps, gapDistance + 1e-4);
                    const dx = (actionTarget.x - origin.x) / (d || 1), dy = (actionTarget.y - origin.y) / (d || 1);
                    const half = this.config.settings.mapSize / 2;
                    candidates.push({ x: clamp(origin.x + direction * dx * extension, -half, half), y: clamp(origin.y + direction * dy * extension, -half, half) });
                }
            }
            let improved = null, improvedGap = bestGap;
            for (const candidate of candidates) {
                if (!candidate || distance(u, candidate) < .001)
                    continue;
                if (distance(u, candidate) > capacity + steps * 10 + 1e-5)
                    continue;
                const candidateGap = gap(candidate);
                if (candidateGap >= improvedGap - .00001)
                    continue;
                improved = candidate;
                improvedGap = candidateGap;
            }
            if (!improved)
                continue;
            best = { move: improved, extraSteps: steps, moveCost: cost };
            bestGap = improvedGap;
            if (validAt(improved))
                break; // least expensive extension that gets into range
        }
        return best;
    }
    skillCost(u, s) {
        return Math.max(1, Number(s.cost || 50) + Math.floor(this.effect(u, s, 'chargeTime') / (1 + Math.max(0, this.effect(u, s, 'fastCast')))));
    }
    choose(u) {
        const bs = this.statuses(u);
        let forced = null;
        for (const name of ['狂気', '魅了', '混乱'])
            if (bs.has(name) && this.d() <= { 狂気: 25, 魅了: 30, 混乱: 20 }[name]) {
                let a = name === '狂気' ? [u] : this.units.filter(t => t.alive && t.id !== u.id && (name !== '魅了' || t.team === u.team));
                if (a.length) {
                    forced = {
                        r: {
                            action: 'attack',
                            autoMove: true,
                            moveMode: 'approach',
                            target: 'all',
                            minDist: 0,
                            maxDist: 3
                        },
                        target: a[Math.floor(this.random() * a.length)],
                        mad: name === '狂気'
                    };
                    this.log('bs', `${u.name}は${name}の影響で通常攻撃を試みる`);
                    break;
                }
            }
        if (!forced) {
            for (const [i, name] of BS_GROUPS[14].entries()) {
                if (bs.has(name) && this.d() <= 15 + 10 * i) {
                    const entry = u.bs.find(b => BS_GROUPS[14].includes(b.name)), t = this.get(entry?.source);
                    if (t?.alive && t.team !== u.team) {
                        forced = { r: {
                                action: 'attack',
                                autoMove: true,
                                moveMode: 'approach',
                                minDist: 0,
                                maxDist: 3
                            }, target: t };
                        break;
                    }
                }
            }
        }
        const rules = forced ? [{ ...forced.r, enabled: true, conditions: [] }] : u.rules;
        for (let i = 0; i < rules.length; i++) {
            const r = rules[i];
            if (!r.enabled)
                continue;
            const check = forced ? { ok: true, targets: [forced.target] } : this.conditions(u, r.conditions);
            this.log('condition', `#${i + 1} 条件 ${check.ok ? '成立' : '不成立'}`, `${check.targets.length}人が該当`, u);
            if (!check.ok)
                continue;
            if (r.action === 'carry' || r.action === 'wait')
                return { r, index: i };
            if (r.action === 'focusAttack' && u.focusA || r.action === 'focusDefense' && u.focusD)
                continue;
            let targets = forced ? [forced.target] : this.targets(u, r, check.targets);
            if (['focusAttack', 'focusDefense'].includes(r.action))
                targets = [u];
            let skills = [];
            if (r.action === 'skill') {
                const s = this.skillFor(u, r.skillId);
                if (u.skills.includes(r.skillId) && s?.kind !== 'passive')
                    skills = [s];
            }
            else if (r.action === 'attack')
                skills = [normalSkill(u)];
            else if (['effectiveAttack', 'healHP', 'healAP', 'healBS'].includes(r.action)) {
                skills = u.skills.map(id => this.skillFor(u, id)).filter(s => s && ({
                    effectiveAttack: s.kind === 'attack' && s.trigger === 'instant',
                    healHP: ['hp', 'ha'].includes(s.kind),
                    healAP: ['ap', 'ha'].includes(s.kind),
                    healBS: (s.effects?.bsHeal || 0) > 0
                })[r.action]);
                if (r.action === 'effectiveAttack')
                    skills.push(normalSkill(u));
            }
            else
                skills = [null];
            let best = null, movementFallback = null;
            const independent = forced ? null : this.movementTargets(u, r, check.targets);
            for (const target of targets) {
                for (const s of skills) {
                    if (s && u.sealed && s.id !== 'normal')
                        continue;
                    if (s && this.apCost(u, s) > u.ap)
                        continue;
                    if (r.action === 'cover' && (target.team !== u.team || target.id === u.id || u.coverId === target.id))
                        continue;
                    if (r.action === 'block' && (target.team === u.team || u.blockId === target.id))
                        continue;
                    const fixedTarget = s && ['self', 'selfArea', 'selfWide'].includes(s.scope) ? u : target;
                    const actionReadyNow = (s && s.trigger === 'instant' ? rangeInfo(s, distance(u, fixedTarget), this.config.settings.rangePolicy, this.effect(u, s, 'versatile') > 0).valid : ['cover', 'block'].includes(r.action) ? distance(u, target) <= 3 : true);
                    // An independent move basis never replaces the action target (or its range).
                    // If several references are available, use the nearest living one consistently.
                    let move = null, moveTarget = fixedTarget, extraSteps = 0;
                    let moveCost = this.config.settings.moveCost || 40;
                    const shouldMove = independent === null || (!(r.movePriority !== 'movement' && actionReadyNow && r.action !== 'move') && independent.length > 0);
                    if (independent !== null && shouldMove)
                        moveTarget = independent[0];
                    if (shouldMove) {
                        const position = this.positionForAction(u, moveTarget, r, s, fixedTarget);
                        move = position.move;
                        extraSteps = position.extraSteps;
                        if (move)
                            moveCost = position.moveCost;
                    }
                    let cost = s ? this.skillCost(u, s) : r.action === 'move' ? 0 : 50;
                    if (move)
                        cost += moveCost;
                    if (r.action === 'move' && !move)
                        continue;
                    let valid = true;
                    if (s && s.trigger === 'instant')
                        valid = rangeInfo(s, distance(move || u, fixedTarget), this.config.settings.rangePolicy, this.effect(u, s, 'versatile') > 0).valid;
                    if (['cover', 'block'].includes(r.action))
                        valid = distance(move || u, target) <= 3;
                    if (!valid) {
                        if (move && !movementFallback && u.av >= moveCost)
                            movementFallback = {
                                r: { ...r, action: 'move' },
                                target: fixedTarget,
                                moveTarget,
                                move,
                                extraSteps,
                                cost: moveCost,
                                index: i
                            };
                        continue;
                    }
                    if (cost > u.av) {
                        // A movement-first rule can still walk toward its reference when its action is too expensive.
                        if (move && r.movePriority === 'movement' && independent !== null && !movementFallback && u.av >= moveCost)
                            movementFallback = {
                                r: { ...r, action: 'move' },
                                target: fixedTarget,
                                moveTarget,
                                move,
                                extraSteps,
                                cost: moveCost,
                                index: i
                            };
                        continue;
                    }
                    let score = s ? (this.stat(u, 'main') * (s.mainPct ?? 100) / 100 + (s.mainBonus || 0) + this.stat(u, 'sub') * (s.subPct ?? 100) / 100 + (s.subBonus || 0)) * (1 + Number(s.hitBonus || 0) / 100) : 1;
                    if (s && r.action === 'healHP')
                        score = Math.min(this.stat(target, 'maxHp') - target.hp, (this.stat(u, 'heal') * (s.kind === 'ha' ? .5 : 1) + s.power) * (1 + (s.effects.healEfficiency || 0) / 100));
                    if (s && r.action === 'healAP')
                        score = Math.min(this.stat(target, 'maxAp') - target.ap, (this.stat(u, 'heal') * (s.kind === 'ha' ? .5 : 1) + s.power) * (1 + (s.effects.healEfficiency || 0) / 100));
                    if (s && r.action === 'healBS')
                        score = target.bs.length * (s.effects.bsHeal || 0) / 100;
                    if (['healHP', 'healAP', 'healBS'].includes(r.action) && score <= 0)
                        continue;
                    if (!best || score > best.score)
                        best = {
                            r,
                            s,
                            target: fixedTarget,
                            moveTarget,
                            move,
                            extraSteps,
                            cost,
                            score,
                            index: i,
                            mad: forced?.mad
                        };
                }
                if (best)
                    break;
            }
            if (best)
                return best;
            if (movementFallback) {
                this.log('condition', `#${i + 1} 射程に届かないため移動のみ`, '', u);
                return movementFallback;
            }
            this.log('condition', `#${i + 1} 実行不可`, '対象・距離・AP・行動値・状態を満たさないため次のルールへ', u);
        }
        return { r: { action: 'carry' }, index: -1 };
    }
    enqueue(u, type, gauge, plan = null) {
        this.events.push({
            u,
            type,
            gauge,
            plan,
            seq: this.seq++,
            tie: this.random(),
            speed: this.stat(u, 'speed')
        });
    }
    startTurn() {
        this.gauge = 0;
        this.turn++;
        const sudden = this.suddenRound();
        if (sudden) {
            // Simultaneous opening HP tax; no individual spam entries.
            // Damage amplification deliberately does NOT apply to this tax.
            const entries = [];
            for (const u of this.units) {
                if (!u.alive) continue;
                const before = u.hp;
                const tax = Math.ceil(before * .20);
                this.hurt(u, tax, null, 0, 0, null, true);
                entries.push(`${u.name} HP ${before.toLocaleString()}→${u.hp.toLocaleString()}（−${tax.toLocaleString()}）`);
            }
            this.log('sudden', `第${this.turn}ターン｜サドンデス ${sudden}/5｜現在HP −20%・CT/FB +${sudden * 5}・被ダメージ +${sudden * 30}%`, entries.join(' / '));
            // If the opening HP tax ends the battle, no one may act this turn.
            if (this.checkEnd()) return false;
        } else {
            this.log('turn', `第${this.turn}ターン`);
        }
        for (const u of this.units) {
            if (!u.alive)
                continue;
            u.ctLoss = 0;
            u.luckLoss = 0;
            u.evadeLoss = 0;
            u.actions = 0;
            u.focusA = false;
            u.focusD = false;
            u.coverId = null;
            u.blockId = null;
            u.pending = false;
            u.waiting = false;
            u.afterWait = false;
            u.waitCount = 0;
            u.carrying = false;
            u.doneTurn = false;
            u.blocked = false;
            u.sealed = false;
            const active = this.statuses(u), res = this.stat(u, 'resist'), ease = this.effectRaw(u, 'bsEase');
            for (const name of active) {
                let dmg = 0, ap = 0;
                for (const gi of [0, 1]) {
                    let i = BS_GROUPS[gi].indexOf(name);
                    if (i >= 0) {
                        i = Math.max(0, i - ease);
                        dmg += clamp(Math.floor(this.stat(u, 'maxHp') * (.02 + i * .01)), 80 * (i + 1), 240 * (i + 1));
                    }
                }
                let bleed = BS_GROUPS[5].indexOf(name), suff = BS_GROUPS[6].indexOf(name);
                if (bleed >= 0)
                    dmg += 120 * (Math.max(0, bleed - ease) + 1);
                if (suff >= 0)
                    ap += 120 * (Math.max(0, suff - ease) + 1);
                if (dmg > 0) {
                    dmg = Math.max(0, dmg - res * 2 - this.effectRaw(u, 'bsArmor'));
                    this.hurt(u, dmg, null, 0, 0, applied => this.log('bs', `${u.name}：${name}でHP −${applied}`));
                }
                if (ap > 0) {
                    ap = Math.max(0, ap - res * 2 - this.effectRaw(u, 'bsArmor'));
                    u.ap = Math.max(0, u.ap - ap);
                    this.log('bs', `${u.name}：${name}でAP −${ap}`);
                }
                const par = BS_GROUPS[12].indexOf(name);
                if (par >= 0 && this.d() <= 20 + Math.max(0, par - ease) * 5)
                    u.blocked = true;
                if (name === '封印' && this.d() <= 30)
                    u.sealed = true;
            }
            const cursed = active.has('呪い');
            u.bs = u.bs.filter(b => {
                if (!cursed || b.name === '呪い')
                    b.remaining--;
                return b.remaining > 0;
            });
            if (!u.alive)
                continue;
            const regen = this.effectRaw(u, 'regen'), charge = this.effectRaw(u, 'charge');
            if (regen)
                this.log('heal', `${u.name}：再生でHP +${this.heal(u, regen, 'hp')}`);
            if (charge)
                this.log('heal', `${u.name}：充填でAP +${this.heal(u, charge, 'ap')}`);
            this.hurt(u, this.effectRaw(u, 'dot'));
            u.ap = Math.max(0, u.ap - this.effectRaw(u, 'lost'));
            if (!u.alive)
                continue;
            const d1 = this.d(), d2 = this.d();
            const speed = this.stat(u, 'speed'), carried = u.carry;
            u.av = Math.max(0, Math.floor(speed + d1 + d2 + carried));
            // One self-contained entry: each die, their sum, speed, carry, and final AV.
            this.log('speed', `${u.name}：速度 ${speed} ＋ 2d100（${d1}＋${d2}＝${d1 + d2}）＋ 持ち越し ${carried} ＝ 残行動値 ${u.av}`, '', u);
            u.carry = 0;
            if (u.blocked) {
                this.log('bs', `${u.name}はBSによりこのターン行動できない`);
                u.doneTurn = true;
            }
            else
                this.enqueue(u, 'decide', u.av);
        }
        this.snapshot(`第${this.turn}ターン 開始`);
        return !this.checkEnd();
    }
    carryUnit(u) {
        u.carry = Math.min(Math.max(0, this.stat(u, 'speed')), Math.max(0, u.av));
        u.carrying = true;
        u.doneTurn = true;
        u.waiting = false;
        this.log('carry', `${u.name}は行動値${u.carry}を持ち越す`, '', u);
    }
    decide(u) {
        const plan = this.choose(u);
        u.afterWait = false;
        if (plan.r.action === 'carry') {
            this.carryUnit(u);
            return;
        }
        if (plan.r.action === 'wait') {
            const next = this.events.filter(e => e.u.id !== u.id && e.u.alive && e.gauge <= u.av).sort((a, b) => b.gauge - a.gauge)[0];
            if (!next || u.waitCount++ >= this.units.length * 2) {
                this.carryUnit(u);
                return;
            }
            u.av = next.gauge;
            u.waiting = true;
            const e = {
                u,
                type: 'wake',
                gauge: next.gauge,
                seq: this.seq++,
                tie: -1,
                speed: -Infinity
            };
            this.events.push(e);
            this.log('wait', `${u.name}は行動値${u.av}まで待機`, '', u);
            return;
        }
        u.waiting = false;
        u.pending = true;
        u.av -= plan.cost;
        this.log('reserve', `${u.name}：${plan.s?.name || ({
            focusAttack: '攻撃集中',
            focusDefense: '防御集中',
            cover: '庇う',
            block: 'ブロック',
            move: '移動のみ'
        }[plan.r.action])}を予約`, `ルール #${plan.index + 1} / 消費行動値 ${plan.cost}${plan.extraSteps ? `（追加移動 ${plan.extraSteps * 10}m / 追加消費 ${this.extraMovementCost(plan.extraSteps)}）` : ''} / 発動 ${u.av}`, u, plan.target);
        this.enqueue(u, 'execute', u.av, plan);
    }
    endTurn() {
        for (const u of this.units) {
            if (!u.alive)
                continue;
            const cursed = this.statuses(u).has('呪い');
            u.bs = u.bs.filter(b => {
                if (!cursed || b.name === '呪い') {
                    const d = this.d();
                    if (d >= 100 - this.stat(u, 'resist')) {
                        b.remaining--;
                        this.log('bs', `${u.name}：${b.name}の回復が1ターン早まった`);
                    }
                }
                return b.remaining > 0;
            });
            u.buffs = u.buffs.filter(b => --b.remaining > 0);
            u.intercepts = u.intercepts.filter(b => --b.remaining > 0);
            u.retaliations = u.retaliations.filter(b => --b.remaining > 0);
        }
        this.snapshot(`第${this.turn}ターン 終了`);
        if (this.turn >= this.config.settings.turns && !this.done)
            this.resolveDraw(`通常20ターン＋サドンデス5ターンで終了`);
    }
    stepTurn() {
        if (this.done)
            return this.result();
        if (!this.startTurn())
            return this.result();
        let count = 0;
        while (this.events.length && !this.done) {
            if (++count > 10000 || ++this.processed > 200000) {
                this.warnings.push('過剰な反復を検出したため停止しました。');
                this.resolveDraw('反復上限により終了');
                break;
            }
            this.events.sort((a, b) => b.gauge - a.gauge || b.speed - a.speed || b.tie - a.tie || a.seq - b.seq);
            const e = this.events.shift(), u = e.u;
            if (!u.alive || u.doneTurn)
                continue;
            this.gauge = e.gauge;
            if (e.type === 'decide')
                this.decide(u);
            else if (e.type === 'wake') {
                u.afterWait = true;
                u.waiting = false;
                this.decide(u);
            }
            else
                this.execute(u, e.plan);
            this.checkEnd();
        }
        this.events = [];
        this.endTurn();
        return this.result();
    }
    run() {
        while (!this.done)
            this.stepTurn();
        return this.result();
    }
    result() {
        return {
            winner: this.winner,
            tiebreak: this.tiebreak,
            turns: this.turn,
            seed: this.seed,
            units: this.units,
            logs: this.logs,
            frames: this.frames,
            warnings: this.warnings,
            done: this.done
        };
    }
    execute(u, p) {
        u.pending = false;
        if (!u.alive)
            return;
        if (p.move) {
            const check = this.movePlan(u, p.moveTarget || p.target, p.r, p.s, this.stat(u, 'mobility') * 10 + 10 * (p.extraSteps || 0));
            if (check) {
                const moved = distance(u, check);
                u.x = check.x;
                u.y = check.y;
                u.distanceMoved += moved;
                u.movementAvSpent += (this.config.settings.moveCost || 40) + this.extraMovementCost(p.extraSteps || 0);
                this.log('move', `${u.name}が${moved.toFixed(1)}m移動`, `(${u.x.toFixed(1)}, ${u.y.toFixed(1)})`, u);
            }
        }
        const a = p.r.action;
        if (a === 'focusAttack') {
            u.focusA = true;
            this.log('buff', `${u.name}は攻撃集中（命中＋10）`, '', u);
        }
        else if (a === 'focusDefense') {
            u.focusD = true;
            this.log('buff', `${u.name}は防御集中（回避・防技・抵抗＋5）`, '', u);
        }
        else if (a === 'cover' || a === 'block') {
            if (p.target.alive && distance(u, p.target) <= 3) {
                u[a === 'cover' ? 'coverId' : 'blockId'] = p.target.id;
                if (a === 'cover')
                    this.log('action', `${u.name}は${p.target.name}への攻撃を警戒している…`, '', u, p.target);
                else
                    this.log('buff', `${u.name}は${p.target.name}をブロック`, '', u, p.target);
            }
            else
                this.log('miss', '対象が至近距離にいないため不発', '', u);
        }
        else if (p.s) {
            const s = p.s;
            if (this.apCost(u, s) > u.ap)
                this.log('miss', `${s.name}はAP不足で不発`, '', u);
            else if (u.sealed && s.id !== 'normal')
                this.log('miss', `${s.name}は封印により不発`, '', u);
            else {
                u.ap -= this.apCost(u, s);
                if (['intercept', 'retaliate'].includes(s.trigger)) {
                    u[s.trigger === 'intercept' ? 'intercepts' : 'retaliations'].push({ skill: clone(s), remaining: 8 });
                    this.log('buff', `${u.name}は${s.name}の${s.trigger === 'intercept' ? '迎撃' : '報復'}を準備`, '', u);
                }
                else
                    this.cast(u, s, p.target, false, 0, p.mad);
            }
        }
        u.actions++;
        u.totalActions++;
        const side = ['focusAttack', 'focusDefense'].includes(a) || (p.s && this.effect(u, p.s, 'side'));
        u.av = Math.max(0, Math.floor(u.av / (side ? 1 : 2)));
        this.log('actionEnd', `${u.name}の残行動値 ${u.av}`, side ? '【副】により半減なし' : '行動後に残りを半減', u);
        if (u.alive && u.av > 0)
            this.enqueue(u, 'decide', Math.min(u.av, this.gauge));
        else
            u.doneTurn = true;
    }
    areaTargets(u, s, target, ignoreRange = false) {
        if (!target?.alive)
            return [];
        if (!ignoreRange && !rangeInfo(s, distance(u, target), this.config.settings.rangePolicy, this.effect(u, s, 'versatile') > 0).valid)
            return [];
        if (s.scope === 'self')
            return [u];
        if (s.scope === 'single')
            return [target];
        const beneficial = s.kind !== 'attack';
        let pool = this.units.filter(t => t.alive);
        if (this.effect(u, s, 'identify') || s.scope === 'random' || s.range === 'special' && s.kind === 'buff')
            pool = pool.filter(t => beneficial ? t.team === u.team : t.team !== u.team);
        if (s.scope === 'random') {
            pool = pool.filter(t => rangeInfo(s, distance(u, t), this.config.settings.rangePolicy, this.effect(u, s, 'versatile') > 0).valid);
            return pool.length ? [pool[Math.floor(this.random() * pool.length)]] : [];
        }
        const range = rangeInfo(s, 0, this.config.settings.rangePolicy, true).max, dx = target.x - u.x, dy = target.y - u.y, d = Math.hypot(dx, dy) || 1;
        let found = pool.filter(t => {
            if (s.scope === 'selfArea')
                return distance(u, t) <= 5;
            if (s.scope === 'selfWide')
                return distance(u, t) <= 10;
            if (s.scope === 'area')
                return distance(target, t) <= 5;
            if (s.scope === 'wide')
                return distance(target, t) <= 10;
            if (s.scope === 'special')
                return distance(s.kind === 'buff' ? u : target, t) <= (s.radius || 20);
            const along = ((t.x - u.x) * dx + (t.y - u.y) * dy) / d, across = Math.abs((t.x - u.x) * dy - (t.y - u.y) * dx) / d;
            if (s.scope === 'pierce')
                return along >= 0 && along <= range && across <= .5;
            if (s.scope === 'cone')
                return along >= 0 && along <= range && across <= along / 2;
            if (s.scope === 'line')
                return Math.abs(along - d) <= .5 && across <= range / 2;
            return false;
        });
        if (s.kind === 'attack')
            found = found.filter(t => t.id !== u.id);
        if (s.range === 'special' && s.kind === 'buff')
            found = found.sort((a, b) => distance(u, a) - distance(u, b)).slice(0, 10);
        return found;
    }
    addBuff(u, s, modifiers, effects, source) {
        if (!Object.keys(modifiers || {}).length && !Object.keys(effects || {}).length)
            return;
        const before = this.stat(u, 'maxHp'), id = s.id + '-' + source.id;
        u.buffs = u.buffs.filter(b => b.id !== id);
        u.buffs.push({ id, remaining: s.buffTurns || 8, modifiers: clone(modifiers || {}), effects: clone(effects || {}) });
        const delta = this.stat(u, 'maxHp') - before;
        if (delta > 0)
            u.hp += delta;
        const entries = [...Object.entries(modifiers || {}).map(([key, val]) => `${STAT_LABELS[key] || key} ${Number(val) >= 0 ? '+' : ''}${val}`),
            ...Object.entries(effects || {}).map(([key, val]) => `${EFFECTS[key] || key}${Number(val) === 1 ? '' : ` ${Number(val) >= 0 ? '+' : ''}${val}`}`)];
        const tags = entries.map(label => ({ kind: 'buff', label }));
        this.log('buff', `${u.name}に${s.name}の付与（${s.buffTurns || 8}ターン）`, entries.join(' / '), source, u, tags);
    }
    cast(u, s, target, ignoreRange = false, depth = 0, mad = false) {
        if (depth > 8 || !u.alive)
            return;
        const targets = this.areaTargets(u, s, target, ignoreRange);
        if (!targets.length) {
            if (target?.alive && !rangeInfo(s, distance(u, target), this.config.settings.rangePolicy, this.effect(u, s, 'versatile') > 0).valid)
                u.outOfRangeFails++;
            this.log('miss', `${u.name}の${s.name}は射程内に対象がおらず不発`, '', u);
            return;
        }
        this.log('skill', `${u.name}の${s.name}`, `対象：${targets.map(t => t.name).join('、')}`, u, target);
        if (s.kind !== 'attack') {
            const roll = this.roll(u, s.castMods);
            if (roll.fumble) {
                u.av = Math.max(0, u.av - roll.fb);
                this.log('miss', `${s.name}の行使に失敗（ファンブル）`, `1d100 ${roll.die} / FB ${roll.fb}`, u);
                return;
            }
            if (roll.critical && s.kind === 'buff')
                this.heal(u, Math.floor(this.apCost(u, s) / 2), 'ap');
            for (const t of targets) {
                if (s.kind !== 'buff') {
                    let heal = (Math.max(0, this.stat(u, 'heal')) * (s.kind === 'ha' ? .5 : 1) * (1 + this.effect(u, s, 'healEfficiency') / 100) + Number(s.power || 0)) * (roll.critical ? 1.5 : 1);
                    const light = this.effectRaw(t, 'radiance');
                    if (light && (t.hp < this.stat(t, 'maxHp') || t.ap < this.stat(t, 'maxAp'))) {
                        heal += light;
                        for (const b of t.buffs)
                            if (b.effects?.radiance)
                                delete b.effects.radiance;
                    }
                    if (['hp', 'ha'].includes(s.kind)) {
                        const n = this.heal(t, heal + this.effect(u, s, 'extraHP'), 'hp', u);
                        this.log('heal', `${t.name}のHP +${n}`, roll.critical ? 'クリティカル回復（1.5倍）' : '', u, t);
                    }
                    if (['ap', 'ha'].includes(s.kind)) {
                        const n = this.heal(t, heal, 'ap', u);
                        this.log('heal', `${t.name}のAP +${n}`, '', u, t);
                    }
                    if (this.effect(u, s, 'bsHeal'))
                        this.cleanse(t, this.effect(u, s, 'bsHeal') + (roll.critical ? 20 : 0), u);
                }
                this.addBuff(t, s, s.modifiers, s.grantedEffects || (s.kind === 'buff' ? s.effects : {}), u);
            }
        }
        else {
            const splash = clamp(Math.floor(this.effect(u, s, 'splash')), 0, 20);
            if (splash)
                this.log('effect', `${u.name}の${s.name}：スプラッシュ ${splash + 1}連撃`, `1ヒットの威力を${splash + 1}分割して判定`, u, target, [{ kind: 'splash', label: `スプラッシュ ×${splash + 1}` }]);
            // A multi-target skill uses exactly one offensive accuracy result for the entire
            // cast, including any splash sub-hits. Single/random attacks keep independent rolls.
            const isArea = MULTI_TARGET_ATTACK_SCOPES.has(s.scope);
            const sharedAccuracy = isArea ? { roll: null, fumbleHandled: false } : null;
            for (let j = 0; j <= splash; j++) {
                if (!isArea) {
                    for (const t of targets)
                        if (t.alive && u.alive)
                            this.attack(u, t, s, depth, 1 + splash, mad, j, sharedAccuracy);
                    continue;
                }
                // Determine redirections before resolving any target's hit. If the coverer is
                // also inside this area, their own area hit is replaced by the hit they
                // take for their protected ally, not added on top of it.
                const resolved = targets.filter(t => t.alive).map(t => ({ original: t, defender: this.coverRecipient(u, t, s) }));
                const covering = new Set(resolved.filter(x => x.original.id !== x.defender.id).map(x => x.defender.id));
                for (const { original, defender } of resolved) {
                    if (!u.alive || !original.alive || covering.has(original.id))
                        continue;
                    const actual = defender.alive ? defender : original;
                    this.attack(u, original, s, depth, 1 + splash, mad, j, sharedAccuracy, actual);
                }
            }
        }
        this.addBuff(u, { ...s, id: s.id + '-self' }, s.selfModifiers, s.selfEffects, u);
        const recoil = this.effect(u, s, 'recoil');
        if (recoil && u.alive) {
            this.hurt(u, recoil, null, 0, 0, applied => this.log('damage', `${u.name}は反動でHP −${applied}`, '', u));
        }
    }
    cleanse(t, chance, u) {
        const n = t.bs.length;
        t.bs = t.bs.filter(() => this.random() * 100 >= chance);
        this.log('heal', `${t.name}のBSを${n - t.bs.length}個回復`, `成功率 ${clamp(chance, 0, 100)}%（各BSを判定）`, u, t);
    }
    counter(t, u, key, depth) {
        if (depth >= 8)
            return;
        const list = t[key].splice(0);
        for (const entry of list)
            if (t.alive && u.alive) {
                this.log('skill', `${t.name}の${key === 'intercepts' ? '迎撃' : '報復'}発動`);
                this.cast(t, { ...entry.skill, trigger: 'instant' }, ['self', 'selfArea', 'selfWide'].includes(entry.skill.scope) ? t : u, true, depth + 1);
            }
    }
    attackRoll(u, s) {
        let attackRoll = this.roll(u, s.castMods, false);
        for (let i = 0; i < clamp(this.effect(u, s, 'multiShadow'), 0, 20) && !attackRoll.fumble; i++) {
            const next = this.roll(u, s.castMods, false);
            if (next.fumble) {
                attackRoll = next;
                break;
            }
            if (next.die > attackRoll.die)
                attackRoll = next;
        }
        if (attackRoll.critical) {
            u.ctLoss += 10;
            u.luckLoss++;
        }
        return attackRoll;
    }
    coverRecipient(u, original, s) {
        const cover = this.units.find(v => v.alive && v.id !== u.id && v.id !== original.id && v.coverId === original.id && distance(v, original) <= 3);
        return cover && this.random() * 100 >= this.effect(u, s, 'curve') ? cover : original;
    }
    attack(u, original, s, depth = 0, split = 1, mad = false, hitIndex = 0, sharedAccuracy = null, preResolvedDefender = null) {
        const t = preResolvedDefender || this.coverRecipient(u, original, s);
        if (t !== original)
            this.log('action', `${t.name}が${original.name}をかばう！`, '', t, original);
        this.counter(t, u, 'intercepts', depth);
        if (!u.alive)
            return;
        if (sharedAccuracy && !sharedAccuracy.roll) {
            sharedAccuracy.roll = this.attackRoll(u, s);
        }
        const attackRoll = sharedAccuracy ? sharedAccuracy.roll : this.attackRoll(u, s);
        if (attackRoll.fumble) {
            if (!sharedAccuracy || !sharedAccuracy.fumbleHandled) {
                u.av = Math.max(0, u.av - attackRoll.fb);
                this.log('miss', `${u.name}の攻撃はファンブル`, `1d100 ${attackRoll.die} / 行動値 −${attackRoll.fb}`, u, t);
                if (sharedAccuracy)
                    sharedAccuracy.fumbleHandled = true;
            }
            this.counter(t, u, 'retaliations', depth);
            return;
        }
        const dodge = this.roll(t), range = rangeInfo(s, distance(u, t), this.config.settings.rangePolicy, this.effect(u, s, 'versatile') > 0).bonus;
        const hit = this.stat(u, 'hit') + Number(s.hitBonus || 0) + range + attackRoll.die, evade = this.stat(t, 'evade') + dodge.die;
        const sure = this.effect(u, s, 'sureHit');
        if (!mad && (dodge.critical || (!dodge.fumble && !attackRoll.critical && !sure && evade >= hit))) {
            t.evadeLoss += 10;
            this.log('miss', `${t.name}は${dodge.critical ? 'クリティカル' : ''}回避`, `命中 ${hit}（${sharedAccuracy ? '攻撃側共通' : '攻撃側'}1d100 ${attackRoll.die}） / 回避 ${evade}（対象別1d100 ${dodge.die}）`, u, t);
            this.counter(t, u, 'retaliations', depth);
            return;
        }
        const rateDie = this.d();
        let rate = mad ? 100 : (sure ? 25 : hit - evade) + rateDie;
        if (attackRoll.critical)
            rate = Math.max(50, rate);
        if (rate >= 150)
            rate = Math.max(100, rate - this.effectRaw(t, 'clever'));
        if (rate <= 0) {
            this.log('miss', `${t.name}は完全回避`, `ヒットレート ${rate}`, u, t);
            this.counter(t, u, 'retaliations', depth);
            return;
        }
        let rank = rate < 50 ? 0 : rate < 100 ? 1 : rate < 150 ? 2 : rate < 200 ? 3 : 4;
        const names = [
            'グレイズ',
            'ライト',
            'クリーン',
            'ハード',
            'スマッシュ'
        ];
        const calcDie = Math.min(140, rateDie + this.effect(u, s, 'steady'));
        let main = Math.max(0, this.stat(u, 'main') * (s.mainPct ?? 100) / 100 + Number(s.mainBonus || 0)) / split, sub = Math.max(0, this.stat(u, 'sub') * (s.subPct ?? 100) / 100 + Number(s.subBonus || 0)) / split;
        main *= 1 + clamp(1 - u.hp / this.stat(u, 'maxHp'), 0, 1) * this.effect(u, s, 'revenge') / 100;
        for (const b of this.statuses(t)) {
            const i = BS_GROUPS[11].indexOf(b);
            if (i >= 0)
                main *= 1 + .25 * (Math.max(0, i - this.effectRaw(t, 'bsEase')) + 1);
        }
        let m = rank === 0 ? main * (.15 + calcDie / 400) : rank === 1 ? main * (.3 + calcDie / 200) : rank === 2 ? main : rank === 3 ? main * (1 + calcDie / 200) : main * (1 + calcDie / 100);
        let subD = rank >= 2 ? sub * (rank === 2 ? 1 : rank === 3 ? 1 + calcDie / 200 : 1 + calcDie / 100) : 0;
        const defense = this.stat(t, 'defense') - this.effect(u, s, 'evil'), defRoll = mad ? { critical: false, fumble: false, die: 0 } : this.roll(t);
        let defended = !mad && defense >= 0 && (defRoll.critical || !defRoll.fumble && defRoll.die >= 100 - defense);
        let reduction = defended ? clamp(70 + (this.effectRaw(t, 'heavy')) - this.effect(u, s, 'weak') * 20 - (defRoll.critical ? 0 : main * .003), 0, 100) / 100 : 0;
        if (attackRoll.critical) {
            const four = this.d() + this.d() + this.d() + this.d();
            subD = sub * Math.max(100, Math.max(120, four) * (1 - defense * .0015)) / 100;
        }
        if (defended) {
            m *= 1 - reduction;
            if (attackRoll.critical || rank === 3)
                subD *= 1 - Math.max(0, reduction * 100 - this.d()) / 100;
            else if (rank !== 4)
                subD *= 1 - reduction;
        }
        if (defRoll.fumble)
            m *= 1 + (15 + defRoll.fb) / 100;
        if (defense < 0)
            m *= 1 + Math.min(1, Math.ceil(-defense / 10) * .2);
        // 追撃は本体攻撃の一部として1回だけHPに反映する。ログ表示用に内訳を保持する。
        const pursuitBase = main * this.effect(u, s, 'pursuit') / 100;
        let extra = pursuitBase;
        if (this.effect(u, s, 'reverse'))
            extra += Math.min(this.stat(t, 'heal'), this.stat(u, 'main'));
        if (this.effect(u, s, 'curseKill'))
            extra += new Set(t.bs.map(b => b.name)).size * 66;
        const elementFactor = 1 + Number(s.elementCorrection || 0) / 100;
        let total = (m + subD + extra) * elementFactor;
        let euphoriaFactor = 1;
        if (this.statuses(t).has('恍惚')) {
            euphoriaFactor = 1 + (this.d() + 30) / 100;
            total *= euphoriaFactor;
            t.bs = t.bs.filter(b => b.name !== '恍惚');
        }
        const noDamage = this.effect(u, s, 'noDamage');
        const hpArmor = this.effectRaw(t, 'hpArmor');
        total = noDamage ? 0 : Math.max(0, Math.floor(total - hpArmor));
        // 属性補正・恍惚・HP鎧・端数切り捨て後の、追撃による実際の増加分。
        // 元の合計値(total)を変えずに、表示上だけ本体／追撃を分離する。
        let pursuitDamage = 0;
        if (pursuitBase > 0 && !noDamage && total > 0) {
            let withoutPursuit = (m + subD + extra - pursuitBase) * elementFactor;
            withoutPursuit *= euphoriaFactor;
            withoutPursuit = Math.max(0, Math.floor(withoutPursuit - hpArmor));
            pursuitDamage = Math.max(0, Math.min(total, total - withoutPursuit));
        }
        const baseDamage = total - pursuitDamage;
        const weakness = this.effect(u, s, 'weak');
        const reductionWithoutWeakness = clamp(70 + this.effectRaw(t, 'heavy') - (defRoll.critical ? 0 : main * .003), 0, 100) / 100;
        const weaknessReduction = defended ? Math.max(0, Math.round((reductionWithoutWeakness - reduction) * 1000) / 10) : 0;
        const processTags = [...(split > 1 ? [{ kind: 'splash', label: `スプラッシュ ${hitIndex + 1}/${split}` }] : []),
            ...(weakness > 0 && weaknessReduction > 0 ? [{ kind: 'weak', label: `弱点：防御軽減 −${weaknessReduction}pt` }] : [])];
        const scaledTotal = this.damageAmount(total);
        const scaledBase = this.damageAmount(baseDamage);
        const scaledPursuit = Math.max(0, scaledTotal - scaledBase);
        const amount = this.hurt(t, total, u, [
            0,
            0,
            25,
            50,
            100
        ][rank], this.effect(u, s, 'lethal'), () => {
            this.log('damage', `${t.name}に${scaledBase.toLocaleString()}ダメージ`, `${attackRoll.critical ? 'CT / ' : ''}${names[rank]}ヒット ${rate} / 命中 ${hit}（${sharedAccuracy ? '攻撃側共通' : '攻撃側'}1d100 ${attackRoll.die}） − 回避 ${evade}（対象別1d100 ${dodge.die}） + ヒットレート1d100 ${rateDie} / 防御 ${defended ? '成功' : '失敗'} (${defRoll.die})`, u, t, processTags);
            if (scaledPursuit > 0)
                this.log('pursuit', `追撃により追加で${scaledPursuit.toLocaleString()}ダメージ！`, `対象：${t.name} / この命中の合計 ${scaledTotal.toLocaleString()}ダメージ`, u, t);
        });
        if (amount > 0 && u.team !== t.team)
            t.incomingHits++;
        u.hits++;
        if (rank >= 2 && u.team !== t.team)
            u.cleanHits++;
        const erosion = Math.max(0, this.effect(u, s, 'erosion') - this.effectRaw(t, 'apArmor'));
        if (erosion) {
            const overflow = Math.max(0, erosion - t.ap);
            t.ap = Math.max(0, t.ap - erosion);
            if (overflow)
                this.hurt(t, Math.max(0, overflow - this.effectRaw(t, 'hpArmor')), u, 0, 0, applied => this.log('damage', `${t.name}のAP −${erosion}`, `AP不足分でHPに追加${applied}ダメージ`, u, t));
            else
                this.log('damage', `${t.name}のAP −${erosion}`, '摩耗', u, t);
        }
        if (amount > 0) {
            const hpDrain = this.effect(u, s, 'hpDrain') + this.effect(u, s, 'haDrain'), apDrain = this.effect(u, s, 'apDrain') + this.effect(u, s, 'haDrain');
            if (hpDrain)
                this.heal(u, amount * hpDrain / 100, 'hp', u);
            if (apDrain)
                this.heal(u, amount * apDrain / 100, 'ap', u);
            if (this.effect(u, s, 'offensiveCleanse'))
                this.cleanse(u, this.effect(u, s, 'offensiveCleanse'), u);
            const reflected = amount * (this.effectRaw(t, 'thorns') ? .3 : this.effectRaw(t, 'reflect') ? .15 : 0);
            if (reflected && depth < 8)
                this.hurt(u, reflected, t);
        }
        if (t.alive) {
            if (this.effect(u, s, 'break') && rank >= 2 && this.random() * 100 >= this.effectRaw(t, 'breakGuard')) {
                const before = this.stat(t, 'maxHp');
                t.buffs = [];
                this.hurt(t, Math.max(0, before - this.stat(t, 'maxHp')));
                this.log('buff', `${t.name}の付与をブレイク`, '', u, t);
            }
            for (const name of s.bs || [])
                this.inflict(u, t, name, s, rank);
            const bind = this.effect(u, s, 'bind');
            if (bind && rank >= 1) {
                let loss = 0;
                for (let i = 0; i < Math.min(10000, bind * rank); i++)
                    loss += this.d(6);
                t.av = Math.max(0, t.av - loss);
                for (const e of this.events)
                    if (e.u.id === t.id)
                        e.gauge = Math.max(0, e.gauge - loss);
                this.log('bs', `${t.name}の行動値 −${loss}（拘束）`);
            }
            if (this.effect(u, s, 'knockback')) {
                const meters = this.d(10) * 2, d = distance(u, t) || 1, half = this.config.settings.mapSize / 2;
                t.x = clamp(t.x + (t.x - u.x) / d * meters, -half, half);
                t.y = clamp(t.y + (t.y - u.y) / d * meters, -half, half);
            }
        }
        if (this.effect(u, s, 'dash')) {
            u.x = original.x;
            u.y = original.y;
        }
        this.counter(t, u, 'retaliations', depth);
    }
    inflict(u, t, name, s, rank) {
        const res = this.stat(t, 'resist') - this.effect(u, s, 'demon') + [
            50,
            25,
            10,
            0,
            -25
        ][rank];
        if ((t.immunities || []).includes(name) && res >= 0 && !this.statuses(t).has('重圧'))
            return;
        const roll = this.roll(t);
        if (roll.critical || !roll.fumble && roll.die >= 100 - res) {
            this.log('bs', `${t.name}は${name}に抵抗`, `${roll.die} / 抵抗 ${res}`, u, t);
            return;
        }
        let count = res < 0 ? Math.min(5, Math.ceil(-res / 25)) : 1;
        if (roll.fumble)
            count = Math.max(count, 1 + Math.ceil(roll.fb / 10));
        count = Math.min(100, count);
        const doubled = res < 0 && this.d() < Math.min(101, -res);
        const baseTurns = 3, duration = baseTurns * (doubled ? 2 : 1);
        const added = Array.from({ length: count }, () => ({ name, remaining: duration, source: u.id, durationDoubled: doubled }));
        t.bs.push(...added);
        const active = t.bs.filter(b => b.name === name && b.remaining > 0);
        const labels = entries => entries.map(bsLogLabel).join('　');
        this.log('bs', `${t.name}にBS付与：${labels(added)}`, `新規：${labels(added)} / 現在：${labels(active)} / 抵抗 ${res} / 1d100 ${roll.die}`, u, t, [{ kind: 'status', label: `追加：${labels(added)}` }]);
    }
}
