import { normalizeMoveModes, STAT_LABELS, SUBJECTS, METRICS, ACTIONS, RANGES, SCOPES, SKILL_KINDS, EFFECTS, BOOL_EFFECTS, BS_NAMES, BS_GROUPS, freshCondition, freshTargetCondition, freshTargetCriterion, targetCriteriaForRule, ensureTargetCriteria, TARGET_SORTS, freshRule, freshSkill, freshUnit, sampleConfig, arrangeInitialPositions, uid, clone, validateConfig, ARENA_SUBJECT_CHOICES, ARENA_ACTION_CHOICES, ARENA_CONDITION_SPECS, ARENA_METRIC_ROWS, ARENA_SORT_ROWS, ARENA_SUBJECT_ROWS, ARENA_MAX_RULES, ARENA_MAX_CONDITIONS } from './model.js';
import { OFFICIAL_MOVE_ROWS } from './official-ai-schema.js?v=1.17.14';
import { isProtectedSkill, isReadOnlySkill, isCustomSkill, copyAsCustom, saveSkillDraft, deleteCustomSkill, migrateLegacyDemoSkills } from './custom-skills.js';
import { Battle, clamp } from './engine.js?v=1.17.14';
import { combatLogTypeLabel, bsStatusLabel } from './combat-log-format.js';
import { teamBattleStats } from './battle-summary.js';
import { exportUnitTactics, importUnitTactics } from './unit-tactics-io.js';
import { exportUnitCharacter, importUnitCharacter } from './unit-character-io.js';
import { parseArenaHtml, importArenaTactics } from './arena-html-import.js';
import { fetchArenaShareCode, extractSharedArenaActions, convertArenaSharedActions, validateArenaShareCode } from './arena-share-import.js?v=1.17.14';
import { newBridgeNonce, officialTabUrl, isOfficialBridgeEvent, officialBookmarkletHref } from './arena-official-bridge.js?v=1.17.14';
import { normalizeSettings } from './run-settings.js';
import { deduplicateImportedSkills, displayedSkillName, displayedSkillText, isWikiSkill } from './skill-dedup.js';
import { MAP_ZOOM_STEPS, mapRelationPairs, mapViewport } from './map-relations.js';
import { replayActorId, groupReplayUnitsByTeam } from './replay-view.js';
import { createCharacterImporter } from './character-ui.js';
import { skillMatchesKind } from './skill-kind-filter.js';
import { cleanWebConfiguration } from './web-configuration.js';
import { ELEMENT_KEYS, emptyElement, elementLevel } from './element-bonus.js?v=1.17.14';
// アクセルカレイド編集用の3分類。既存WIKI・保存済みスキルの分類は維持する。
const ACCEL_KINDS = { attack: '攻撃', heal: '回復', buff: '付与' };
const ACCEL_HEAL_MODES = { hp: 'HP回復', ap: 'AP回復', ha: 'HP・AP回復', cleanse: 'BS回復' };
const ACCEL_RANGES = Object.fromEntries(Object.entries(RANGES).filter(([key]) => key !== 'special'));
const ACCEL_SCOPES = Object.fromEntries(Object.entries(SCOPES).filter(([key]) => key !== 'special'));
// 万能 is intrinsic to recovery skills, so it is intentionally absent from recovery effect menus.
const ACCEL_COMMON = [
    'side',
    'identify',
    'efficiency',
    'chargeTime',
    'fastCast'
];
const ACCEL_HEAL_EFFECTS = Object.fromEntries(Object.entries(EFFECTS).filter(([key]) => [...ACCEL_COMMON, 'healEfficiency', 'extraHP', 'bsHeal'].includes(key)));
const ACCEL_BUFF_EFFECTS = Object.fromEntries(Object.entries(EFFECTS).filter(([key]) => !['charge'].includes(key)));
const ACCEL_ATTACK_EFFECTS = Object.fromEntries(Object.entries(EFFECTS).filter(([key]) => ![
    'healEfficiency',
    'extraHP',
    'bsHeal',
    'regen',
    'charge',
    'barrier'
].includes(key)));
const isAccelHeal = kind => ['hp', 'ap', 'ha', 'cleanse'].includes(kind);
const accelCategory = kind => isAccelHeal(kind) ? 'heal' : kind === 'attack' ? 'attack' : 'buff';
const accelEffects = kind => isAccelHeal(kind) ? ACCEL_HEAL_EFFECTS : kind === 'buff' ? ACCEL_BUFF_EFFECTS : ACCEL_ATTACK_EFFECTS;
function adaptAccelDraft(draft) {
    if (draft.kind === 'passive')
        draft.kind = 'buff';
    delete draft.passiveWhen;
    delete draft.interval;
    delete draft.customRange;
    delete draft.radius;
    if (draft.range === 'special')
        draft.range = 'mid';
    if (draft.scope === 'special')
        draft.scope = 'area';
    draft.effects = Object.fromEntries(Object.entries(draft.effects || {}).filter(([key]) => key in accelEffects(draft.kind)));
    for (const group of ['effects', 'grantedEffects', 'selfEffects']) {
        for (const key of Object.keys(draft[group] || {})) {
            if (FLAG_EFFECTS.has(key)) draft[group][key] = 1;
        }
    }
    draft.bsTurns = 3;
    if (draft.kind !== 'attack') {
        draft.trigger = 'instant';
        draft.bs = [];
    }
    if (draft.kind === 'cleanse' && !Number(draft.effects.bsHeal))
        draft.effects.bsHeal = 100;
    return draft;
}
const KEY = 'arcadia-battle-lab-v1';
const FLAG_EFFECTS = new Set(BOOL_EFFECTS);
const GRANT_STAT_LABELS = Object.fromEntries(Object.entries(STAT_LABELS).filter(([key]) => !['maxHp', 'maxAp'].includes(key)));
function makeSample() {
    const c = sampleConfig();
    c.name = '新しい対戦';
    c.units = [freshUnit({
            id: 'a1',
            name: 'チームAのキャラクター',
            team: 'A',
            x: -10,
            y: 0,
            skills: []
        }), freshUnit({
            id: 'b1',
            name: 'チームBのキャラクター',
            team: 'B',
            x: 10,
            y: 0,
            skills: []
        })];
    return c;
}
let config;
try {
    config = JSON.parse(localStorage.getItem(KEY));
    if (!config || config.version !== 1 || !Array.isArray(config.units) || !config.units.length || !Array.isArray(config.skills) || !config.settings)
        config = makeSample();
}
catch {
    config = makeSample();
}
migrateLegacyDemoSkills(config);
// Update the original default team B character name in previously saved formations.
// Other user-created names and character identifiers are left untouched.
for (const unit of config.units) {
    if (unit.team === 'B' && ['b1', 'b2'].includes(unit.id) && unit.name === 'トリックスター') {
        unit.name = 'チームBのキャラクター';
    }
}
cleanWebConfiguration(config);
normalizeMoveModes(config);
deduplicateImportedSkills(config);
normalizeSettings(config);
if (config.initialLayoutVersion !== 2) {
    arrangeInitialPositions(config.units);
    config.initialLayoutVersion = 2;
}
let selectedLogId = -1, logScrollTop = null, logScrollFrame = 0, unitTacticsImportTarget = null, characterJsonImportTarget = null, arenaImportTarget = null, arenaImportReport = null;
let mapZoom = 1, mapRelations = false, mapMoveCircle = false, mapFocus = 'selected', mapPan = { x: 0, y: 0 }, mapDrag = null;
const mobileExpandedRules = new Set([0]);
let shareImportActions = null, shareImportTargetId = null, shareImportBusy = false, pendingShareBridge = null;
let page = 'setup', selected = config.units[0].id, skillSearch = '', kindFilter = 'all', skillFilter = 'all', skillPage = 0, sim = null, frame = -1, logType = 'main', logTurn = 'all', logSearch = '', worker = null, batch = null, batchCount = 100, busy = false, modalDraft = null, modalMode = 'skill', errors = [], saveFailed = false;
const $ = s => document.querySelector(s), app = $('#app');
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
const nf = x => Math.round(Number(x) || 0).toLocaleString('ja-JP');
const current = () => config.units.find(u => u.id === selected) || config.units[0];
const openCharacterImport = createCharacterImporter({
    getConfig: () => config,
    getCurrent: () => current(),
    onApply: (next, unit, summary) => {
        config = next;
        selected = unit.id;
        sim = null;
        batch = null;
        frame = -1;
        selectedLogId = -1;
        errors = [];
        save();
        render();
        toast(`${unit.name}を読み込みました。スキル追加 ${summary.added}件／既存利用 ${summary.reused}件。`);
    }
});
const save = () => {
    try {
        localStorage.setItem(KEY, JSON.stringify(config));
        saveFailed = false;
    }
    catch {
        saveFailed = true;
        toast('自動保存できません。必要なキャラをJSONで書き出して保存してください。');
    }
    const el = $('#save-status');
    if (el)
        el.textContent = saveFailed ? '保存できません' : 'このブラウザに保存済み';
};
const toast = m => {
    const t = $('#toast');
    t.textContent = m;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
};
const icons = {
    setup: '<path d="M4 21v-7m0-4V3m8 18V9m0-4V3m8 18v-3m0-4V3M1 14h6M9 5h6m2 13h6"/>',
    skills: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
    rules: '<path d="M5 3v12a4 4 0 0 0 4 4h10M5 8h10"/><circle cx="5" cy="3" r="2"/><circle cx="18" cy="8" r="3"/><circle cx="20" cy="19" r="2"/>',
    sim: '<path d="m8 4 12 8-12 8V4Z"/>',
    guide: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    moon: '<path d="M20.7 13.2A9 9 0 0 1 10.8 3.3 9 9 0 1 0 20.7 13.2Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.setup}</svg>`;
const btn = (text, act, cls = '', attrs = '') => `<button class="${cls}" data-act="${act}" ${attrs}>${text}</button>`;
const options = (obj, value) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${String(value) === k ? 'selected' : ''}>${esc(v)}</option>`).join('');
const select = (obj, value, attrs = '') => `<select ${attrs}>${options(obj, value)}</select>`;
const field = (label, content) => `<label class="field"><span>${label}</span>${content}</label>`;
const input = (key, value, attrs = '') => `<input type="number" data-unit="${key}" value="${esc(value)}" step="any" ${attrs}>`;
const unitSelect = () => select(Object.fromEntries(config.units.map(u => [u.id, `${u.team}｜${u.name}`])), selected, 'class="unit-selector" aria-label="編集するユニット" data-select-unit');
const unitTacticsControls = () => {
    const buttons = `${btn('書き出し', 'export-unit-tactics', 'small', 'title="スキル・AIを書き出す" aria-label="選択中のキャラのスキル・AIを書き出す"')}${btn('読み込み', 'import-unit-tactics', 'small', 'title="スキル・AIを読み込む" aria-label="選択中のキャラにスキル・AIを読み込む"')}${btn('アリーナ取込', 'import-arena-tactics', 'small', 'title="公式アリーナHTMLから戦術を読み込む" aria-label="公式アリーナHTMLから戦術を読み込む"')}${btn('共有コード', 'import-share-code', 'small', 'title="公式アリーナの共有コードからAIを読み込む"')}`;
    return `<div class="unit-tactics-buttons desktop-tactics-controls" role="group" aria-label="スキル・AI管理"><span class="unit-tactics-label">スキル・AI</span>${buttons}</div><details class="mobile-tactics-details"><summary>スキル・AI管理</summary><div class="mobile-tactics-actions">${buttons}</div></details>`;
};
function render() {
    const titles = { setup: '編成・ステータス', skills: 'スキルライブラリ', rules: 'キャラAI設定（β版）', sim: 'シミュレーション' };
    const mobileTitles = { setup: '編成', skills: 'スキル', rules: 'AI設定', sim: '戦闘' };
    const mobileNav = `<nav class="mobile-bottom-nav" aria-label="スマートフォン用メニュー">${Object.entries(mobileTitles).map(([k, v]) => btn(`${icon(k)}<span>${v}</span>`, `page:${k}`, page === k ? 'active' : '', `aria-label="${titles[k]}" ${page === k ? 'aria-current="page"' : ''}`)).join('')}</nav>`;
    const mobileTools = `<div class="mobile-top-tools"><button class="mobile-theme-toggle" type="button" data-act="toggle-theme" aria-label="${document.documentElement.dataset.theme === 'dark' ? 'ライトモードに変更' : 'ダークモードに変更'}" title="明暗の切替">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button><details class="mobile-file-menu"><summary>データ</summary><div class="mobile-file-menu-panel">${btn('キャラJSONを読み込む', 'import-character')}${btn('キャラJSONを書き出す', 'export-character')}${btn('不具合報告', 'open-bug-report')}</div></details></div>`;
    app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><strong>ロスアカ Battle Lab</strong><small>闘技趣味レーター</small>\
</div><div class="nav-label">メニュー</div><nav class="nav" aria-label="メインナビゲーション">${Object.entries(titles).map(([k, v]) => btn(`${icon(k)}<span>${v}</span>${k === 'skills' ? '<span class="count">220</span>' : ''}`, `page:${k}`, page === k ? 'active' : '')).join('')}</nav>\
<div class="sidebar-footer"><details class="desktop-data-tools"><summary>キャラデータ管理</summary><div class="desktop-data-tool-actions">${btn('キャラJSONを読み込む', 'import-character')}${btn('キャラJSONを書き出す', 'export-character')}</div></details>${btn('不具合を報告', 'open-bug-report', 'sidebar-bug-report')}<button type="button" class="theme-toggle" data-act="toggle-theme" aria-pressed="${document.documentElement.dataset.theme === 'dark'}" aria-label="画面の明暗を切り替える">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}<span class="theme-toggle-label">${document.documentElement.dataset.theme === 'dark' ? 'ライトモードに切替' : 'ダークモードに切替'}</span></button><span class="saved desktop-save-status" id="save-status">${saveFailed ? '保存できません' : 'ブラウザに自動保存'}</span><div class="version">Web版 1.17.14</div></div></aside><main class="main"><header class="topbar"><div class="mobile-top-brand">Battle Lab <small>v1.17.14</small></div><div class="breadcrumb">\
ロスアカ Battle Lab <span style="margin:0 9px;color:#a6aeb5">/</span> ${titles[page]}</div>\
<div class="top-actions"><span class="saved">${saveFailed ? '保存できません' : 'ブラウザに自動保存'}</span>${btn('キャラJSONを読み込む', 'import-character')}${btn('キャラJSONを書き出す', 'export-character')}</div>${mobileTools}</header><div class="content">${errors.length ? `<div class="error-box" role="alert">${errors.map(esc).join('<br>')}</div>` : ''}${({ setup: setupPage, skills: skillsPage, rules: rulesPage, sim: simPage }[page])()}</div>\
</main>${page === 'sim' && sim ? `<aside id="mobile-replay-map" class="mobile-replay-map" hidden aria-label="ログ閲覧中の戦闘マップ"><button type="button" class="mobile-replay-map-button" data-act="map-expand" aria-label="現在の戦闘マップを拡大表示"><div id="mobile-replay-map-view" class="mobile-replay-map-view" aria-hidden="true"></div><span class="mobile-replay-map-caption"><span id="mobile-replay-map-turn">戦闘マップ</span><span>拡大 ↗</span></span></button></aside>` : ''}${mobileNav}</div>`;
    if (page === 'sim' && sim)
        bindReplay();
}
const heading = (eyebrow, title, subtitle, buttons = '') => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}</div>\
<div class="btnrow">${buttons}</div>\
</div>`;
const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;
function teams() {
    const canAdd = config.units.length < 16;
    const strips = ['A', 'B'].map(team => {
        const members = config.units.filter(unit => unit.team === team);
        const chips = members.map((unit, index) => btn(`<span class="avatar ${team === 'B' ? 'enemy' : ''}">${team}${index + 1}</span>\
<span><strong>${esc(unit.name)}</strong>\
<small>HP ${nf(unit.maxHp)} · SPD ${nf(unit.speed)}</small>\
</span>`, `unit:${unit.id}`, `unit-chip ${unit.id === selected ? 'selected' : ''}`)).join('');
        return `<div class="team-strip ${team === 'B' ? 'enemy' : ''}"><div class="team-title"><b>チーム${team} <span style="font-size:9px;font-weight:400;margin-left:8px">${team === 'A' ? '自チーム' : '相手チーム'}</span>\
</b><span class="subtle">${members.length}人</span>\
</div><div class="unit-row">${chips}${btn('+', `add-unit:${team}`, 'add-chip', `aria-label="チーム${team}にユニットを追加" ${canAdd ? '' : 'disabled'}`)}</div>\
</div>`;
    });
    return `<div class="teams">${strips.join('')}</div>`;
}
function map(units = config.units, large = false, expanded = false, compact = false) {
    const size = config.settings.mapSize || 150, half = size / 2, w = expanded ? 1050 : large ? 540 : 300, h = expanded ? 680 : large ? 340 : 205;
    const scale = Math.min((w - 40) / size, (h - 24) / size), cx = w / 2, cy = h / 2;
    // The floating thumbnail is always an overview, independent of the dialog zoom/pan.
    const viewport = mapViewport(w, h, scale, compact ? 1 : mapZoom, compact ? { x: 0, y: 0 } : mapPan, size);
    let grid = '';
    for (let v = -half; v <= half; v += 10) {
        const x = cx + v * scale, y = cy + v * scale;
        grid += `<path d="M${x} 10v${h - 20}M10 ${y}h${w - 20}" stroke="#dce5d7" stroke-width=".65"/>`;
    }
    const inReplay = page === 'sim';
    const actionActorId = inReplay && sim ? replayActorId(sim.logs, sim.frames, frame, selectedLogId) : null;
    const focusId = mapFocus === 'selected' ? (inReplay ? actionActorId : selected) : mapFocus;
    const links = !compact && mapRelations ? mapRelationPairs(units, focusId) : [];
    const connections = links.map(({ from, to, distance, direction }, index) => {
        const x1 = cx + from.x * scale, y1 = cy - from.y * scale, x2 = cx + to.x * scale, y2 = cy - to.y * scale;
        const mx = (x1 + x2) / 2 + (index % 2 ? 5 : -5), my = (y1 + y2) / 2 + ((index % 3) - 1) * 13;
        const label = distance.toFixed(1) + 'm';
        const labelWidth = Math.max(24, label.length * 5.4 + 8);
        return `<g class="map-relation" data-from="${esc(from.id)}" data-to="${esc(to.id)}"><title>${esc(from.name)} → ${esc(to.name)}: ${label}・${direction}</title>\
<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${from.team === to.team ? '#6796a2' : '#a97760'}" stroke-width="1.2" stroke-dasharray="${from.team === to.team ? '3 3' : 'none'}" opacity=".72"/>${links.length <= 8 ? `<rect x="${mx - labelWidth / 2}" y="${my - 8.5}" width="${labelWidth}" height="13" rx="4" fill="#fff" fill-opacity=".94" stroke="#d8dfd4" stroke-width=".5"/>\
<text x="${mx}" y="${my + 1}" font-size="8.5" text-anchor="middle" fill="#233e32" font-weight="650">${label}</text>` : ''}</g>`;
    }).join('');
    const markers = units.map((u, i) => {
        const x = cx + u.x * scale, y = cy - u.y * scale, markerRadius = Math.min(9, Math.max(3.5, 5 * scale * .44)), color = u.team === 'A' ? '#4f8362' : '#b47961';
        return `<g data-map-unit="${esc(u.id)}" data-x="${u.x}" data-y="${u.y}" opacity="${u.alive === false ? .3 : 1}"><title>${esc(u.name)} (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) m</title>\
<circle cx="${x}" cy="${y}" r="${u.id === (inReplay ? actionActorId : selected) ? 19 : 15}" fill="${color}" opacity=".10"/>\
<circle cx="${x}" cy="${y}" r="${markerRadius}" fill="${color}" stroke="#fff" stroke-width="2"/>\
<text x="${x}" y="${y + 3}" font-size="${Math.min(7, markerRadius * 1.3)}" fill="white" text-anchor="middle">${u.team}${units.filter(z => z.team === u.team).findIndex(z => z.id === u.id) + 1}</text>${large || expanded ? `<text x="${x}" y="${y + 25}" text-anchor="middle" fill="${color}" font-size="9">${esc(u.name)}</text>` : ''}</g>`;
    }).join('');
    const movementUnit = units.find(u => u.id === (inReplay ? actionActorId : selected));
    const baseMobility = Math.max(0, Number(config.units.find(u => u.id === movementUnit?.id)?.mobility) || 0);
    const moveRadius = baseMobility * 10;
    const maskId = 'move-bounds-' + (compact ? 'thumbnail' : expanded ? 'dialog' : large ? 'replay' : 'setup');
    const movementDisk = !compact && mapMoveCircle && movementUnit && moveRadius > 0 ? `<g class="map-movement-disk" clip-path="url(#${maskId})" data-map-move-unit="${esc(movementUnit.id)}" data-map-move-radius="${moveRadius}">\
<title>${esc(movementUnit.name)}：基礎機動力${baseMobility}、通常移動で最大${moveRadius}m</title>\
<circle cx="${cx + movementUnit.x * scale}" cy="${cy - movementUnit.y * scale}" r="${moveRadius * scale}" fill="#5b91af" fill-opacity=".095" stroke="#3b7da2" stroke-width="1.5" stroke-dasharray="5 3"/>\
</g>` : '';
    const positionOptions = {
        selected: inReplay ? '行動中のキャラ' : '編集中のキャラ',
        all: '全キャラ同士',
        ...Object.fromEntries(units.map(u => [u.id, `${u.team}｜${u.name}`]))
    };
    const controls = compact ? '' : `<div class="map-tools"><label class="checkbox-label"><input type="checkbox" data-map-relations ${mapRelations ? 'checked' : ''}>\
位置関係・距離を表示</label><label class="checkbox-label"><input type="checkbox" data-map-movement ${mapMoveCircle ? 'checked' : ''}>\
移動可能範囲を表示</label><div class="map-zoom-controls"><button type="button" class="small" data-act="map-zoom-out" ${mapZoom === 1 ? 'disabled' : ''} aria-label="マップを縮小">\
－</button><output aria-label="マップの倍率">${Math.round(mapZoom * 100)}%</output>\
<button type="button" class="small" data-act="map-zoom-in" ${mapZoom === 4 ? 'disabled' : ''} aria-label="マップを拡大">\
＋</button><button type="button" class="small" data-act="map-center" ${mapZoom === 1 ? 'disabled' : ''}>\
中心に戻す</button>${expanded ? '' : btn('拡大表示', 'map-expand', 'small')}</div>\
</div>${mapRelations ? `<div class="map-focus-row">\
<label>線を表示する組み合わせ ${select(positionOptions, mapFocus, 'data-map-focus aria-label="位置関係の比較対象"')}</label>\
<span class="subtle">実線：敵味方間／点線：同チーム</span></div>` : ''}`;
    const movementLegend = !compact && mapMoveCircle ? `<div class="map-focus-row"><span class="subtle">${movementUnit ? `${esc(movementUnit.name)}：基礎機動力 ${baseMobility} × 10m ＝ 移動半径 ${moveRadius}m` : 'この時点では行動中のキャラがいません'}（戦闘中の機動力補正は別途適用）</span>\
</div>` : '';
    const distanceList = !compact && mapRelations ? `<div class="map-distance-list" aria-label="キャラ同士の距離一覧">${links.map(({ from, to, distance, direction }) => `<div class="map-distance-row">\
<span>${esc(from.name)} <b>\
→</b> ${esc(to.name)}</span>\
<strong>${distance.toFixed(1)}m</strong>\
<small>${direction}</small>\
</div>`).join('') || (inReplay && mapFocus === 'selected' && !actionActorId ? '<p class="subtle">この時点では行動中のキャラはいません。ログの行動を選ぶと距離を表示します。</p>' : '<p class="subtle">表示するキャラの組み合わせがありません。</p>')}</div>` : '';
    return `<div class="map-view${compact ? ' map-view-compact' : ''}">${controls}${movementLegend}<div class="map-surface"><svg class="battle-map" viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}" data-base-width="${w}" data-base-height="${h}" data-base-scale="${scale}" role="img" aria-label="両チームの現在位置を表示する戦闘マップ。倍率${Math.round((compact ? 1 : mapZoom) * 100)}%" style="touch-action:${!compact && mapZoom > 1 ? 'none' : 'auto'}">\
<defs><pattern id="${compact ? 'mapdots-thumbnail' : expanded ? 'mapdots-dialog' : large ? 'mapdots-replay' : 'mapdots-setup'}" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r=".5" fill="#ccd7c6"/></pattern>\
<clipPath id="${maskId}">\
<rect x="${cx - half * scale}" y="${cy - half * scale}" width="${size * scale}" height="${size * scale}"/>\
</clipPath></defs><rect width="${w}" height="${h}" fill="#f7f9f5"/>\
<rect width="${w}" height="${h}" fill="url(#${compact ? 'mapdots-thumbnail' : expanded ? 'mapdots-dialog' : large ? 'mapdots-replay' : 'mapdots-setup'})"/>${grid}<path d="M${cx} 10v${h - 20}M10 ${cy}h${w - 20}" stroke="#c3d2bb" stroke-width="1" stroke-dasharray="3 4"/>\
<text x="12" y="19" fill="#8c9c83" font-size="8">TACTICAL FIELD</text>${movementDisk}${connections}${markers}<text x="${w - 12}" y="${h - 10}" text-anchor="end" fill="#899880" font-size="8">\
1 GRID = 10m</text></svg></div>${compact ? '' : `<div class="map-caption"><span><i class="dot"></i> TEAM A　 <i class="dot" style="background:#b47961">\
</i> TEAM B</span><span>${size} × ${size}m</span>\
</div>${distanceList}`}</div>`;
}
function currentMapUnits() {
    return page === 'sim' && sim ? sim.frames[frame]?.units || sim.frames.at(-1)?.units || config.units : config.units;
}
function refreshMobileReplayMap(units = currentMapUnits()) {
    const thumbnail = $('#mobile-replay-map-view');
    if (!thumbnail || !sim) return;
    thumbnail.innerHTML = map(units, false, false, true);
    const label = $('#mobile-replay-map-turn');
    const log = sim.logs.find(entry => entry.id === selectedLogId);
    if (label) label.textContent = log ? `T${String(log.turn).padStart(2, '0')} マップ` : 'マップ';
}
function updateMobileReplayMapVisibility() {
    const floating = $('#mobile-replay-map');
    if (!floating) return;
    const logs = $('#log-entries'), original = $('#replay-map');
    if (!logs || !original || !window.matchMedia('(max-width: 700px)').matches) {
        floating.hidden = true;
        return;
    }
    const visibleHeight = window.visualViewport?.height || window.innerHeight;
    const logRect = logs.getBoundingClientRect(), mapRect = original.getBoundingClientRect();
    // Only show it when the actual replay log is visible and the regular map is off screen.
    floating.hidden = !(logRect.top < visibleHeight - 64 && logRect.bottom > 60 && mapRect.bottom <= 60);
}
let floatingMapFrame = 0;
function scheduleMobileReplayMapVisibility() {
    if (floatingMapFrame) return;
    floatingMapFrame = requestAnimationFrame(() => {
        floatingMapFrame = 0;
        updateMobileReplayMapVisibility();
    });
}
window.addEventListener('scroll', scheduleMobileReplayMapVisibility, { passive: true });
window.addEventListener('resize', scheduleMobileReplayMapVisibility, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleMobileReplayMapVisibility, { passive: true });

function repaintMaps() {
    const setup = $('#setup-map');
    if (setup)
        setup.innerHTML = map(config.units, false);
    const replay = $('#replay-map');
    if (replay && sim)
        replay.innerHTML = map(currentMapUnits(), true);
    if (replay && sim) refreshMobileReplayMap();
    repaintExpandedMap();
}
function repaintExpandedMap() {
    const el = $('#map-dialog-content');
    if (el && $('#map-dialog')?.open)
        el.innerHTML = map(currentMapUnits(), true, true);
}
function openExpandedMap() {
    const dlg = $('#map-dialog');
    if (!dlg)
        return;
    dlg.showModal();
    repaintExpandedMap();
}
function importedProfileDetails(u) {
    const p = u.importedProfile;
    if (!p)
        return '';
    return `<details class="accordion"><summary>読み込んだキャラクターの参照情報</summary><p class="footnote"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.characterId)} ↗</a>\
 / ${esc(new Date(p.fetchedAt).toLocaleString('ja-JP'))}</p>${(p.warnings || []).map(w => `<p class="import-warning">${esc(w)}</p>`).join('')}${(p.unsupported || []).map(s => `<div class="source-quote">\
未セット：${esc(s.name)}<br>${esc(s.original)}<br>\
未対応：${s.issues.map(esc).join('、')}</div>`).join('')}</details>`;
}
function setupPage() {
    const u = current();
    return heading('BATTLE CONFIGURATION', '編成・ステータス', '', btn('キャラURLから読み込む', 'character-import') + btn(`${icon('sim', 'inline-icon')}実行画面へ`, 'page:sim', 'primary')) + teams() + `<div class="two-col">\
<section class="panel"><div class="panel-head"><div><h2>${esc(u.name)} <span class="rule-count">\
/ TEAM ${u.team}</span>\
</h2></div><div class="btnrow">${btn('複製', 'clone-unit', 'small')}${btn('削除', 'delete-unit', 'small danger')}</div>\
</div><div class="panel-body"><div class="fields two">${field('ユニット名', `<input data-unit="name" value="${esc(u.name)}" maxlength="50">`)}${field('陣営', select({ A: 'チームA / 自チーム', B: 'チームB / 相手チーム' }, u.team, 'data-unit="team"'))}</div>\
<div class="field-section">耐久・リソース</div><div class="fields two"><div class="meter-field">${field('MAX HP', input('maxHp', u.maxHp, 'min="1"'))}<div class="bar">\
</div></div><div class="meter-field ap">${field('MAX AP', input('maxAp', u.maxAp, 'min="0"'))}<div class="bar">\
</div></div></div><div class="field-section">攻撃・防御</div><div class="fields">${[
        'main',
        'sub',
        'heal',
        'hit',
        'evade',
        'defense',
        'resist'
    ].map(k => field(STAT_LABELS[k], input(k, u[k]))).join('')}</div><div class="field-section">行動・判定</div><div class="fields">${[
        'speed',
        'mobility',
        'critical',
        'fumble',
        'drama'
    ].map(k => field(STAT_LABELS[k], input(k, u[k]))).join('')}${field('通常攻撃の射程', select(RANGES, u.normalRange, 'data-unit="normalRange"'))}</div>\
<div class="field-section">属性（ダメージ補正のみ）</div><div class="element-single">${field('属性', `<select data-element-key><option value="" ${!u.element?.key ? 'selected' : ''}>未設定</option>${ELEMENT_KEYS.map(k => `<option value="${k}" ${u.element?.key === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}${field('属性値', `<input type="number" min="0" max="1000000" step="1" inputmode="numeric" data-element-value value="${u.element?.value ?? 0}" ${!u.element?.key ? 'disabled' : ''}>`)}<span class="element-level" data-element-level>Lv${elementLevel(u.element?.value)}</span></div>\
<details class="accordion"><summary>初期位置・開始HP/AP・特殊効果</summary><div class="fields four">${field('初期X座標 (m)', input('x', u.x))}${field('初期Y座標 (m)', input('y', u.y))}${field('開始HP (%)', input('startHp', u.startHp, 'min="0" max="100"'))}${field('開始AP (%)', input('startAp', u.startAp, 'min="0" max="100"'))}</div>\
<div class="fields two" style="margin-top:15px">${field('開始時BS（Ctrl/⌘で複数選択）', `<select multiple class="multi-bs" data-unit-bs>${BS_NAMES.map(b => `<option ${(u.initialBS || []).includes(b) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`)}${field('BS耐性（Ctrl/⌘で複数選択）', `<select multiple class="multi-bs" data-unit-immunity>${BS_NAMES.map(b => `<option ${(u.immunities || []).includes(b) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`)}</div>\
<div class="btnrow" style="margin-top:15px">${btn('固有の特殊効果を編集', 'unit-effects', 'small')}</div>\
</details>${importedProfileDetails(u)}<p class="footnote">\
追加・削除・陣営変更時には、両陣営を20m離して各チーム5m間隔に自動整列します。X・Y座標は個別変更も可能です。</p></div></section><aside class="aside-grid"><section class="panel"><div class="panel-head">\
<h2>初期配置</h2></div>\
<div class="panel-body"><div id="setup-map">${map()}</div>\
<div class="aside-stat"><div><span>装備スキル</span><strong>${u.skills.length}<small style="font-size:11px;margin-left:4px">\
種</small></strong></div><div><span>キャラAI設定（β版）</span><strong>${u.rules.filter(r => r.enabled).length}<small style="font-size:11px;margin-left:4px">\
件</small></strong></div></div></div></section><section class="panel"><div class="panel-head"><h2>このユニットの戦術</h2>${btn('編集', 'page:rules', 'small ghost')}</div>\
<div class="panel-body" style="padding-top:8px">${u.rules.slice(0, 4).map((r, i) => `<div class="mini-rule">\
<span class="num">0${i + 1}</span>\
<div>${esc(actionName(r, u))}<small>${r.conditions.length ? conditionSummary(r.conditions[0]) : '無条件'}</small>\
</div></div>`).join('')}<div class="hint">\
上のルールから順に判定し、実行できる最初の行動を選択します。</div></div></section><section class="panel"><div class="panel-body"><h3>データ管理</h3><p class="subtitle">\
設定はブラウザに自動保存されます。</p><div class="unit-tactics-management"><h3>${esc(u.name)} のキャラクター設定</h3>\
<p class="subtle">上部の「キャラJSON」で、このキャラの能力値とスキル・AIを1人ずつ入出力できます。</p><div class="unit-tactics-buttons">${btn('このキャラをJSONで書き出す', 'export-character', 'small')}${btn('このキャラにJSONを読み込む', 'import-character', 'small')}</div><p class="subtle">スキル・AIのみを移す場合：</p>${unitTacticsControls()}</div>${btn('初期編成に戻す', 'reset-config', 'small danger', 'style="margin-top:12px"')}</div>\
</section></aside></div>`;
}
const actionName = (r, u = current()) => r.action === 'skill' ? displayedSkillName(u, config.skills.find(s => s.id === r.skillId)) || 'スキル未選択' : ACTIONS[r.action];
function conditionSummary(c) {
    if (c.type === 'turn')
        return `${c.multiple}の倍数＋${c.offset}ターン${c.not ? 'ではない' : ''}`;
    if (c.type === 'afterWait')
        return `待機直後${c.not ? 'ではない' : ''}`;
    if (c.type === 'chance')
        return `確率 ${c.chance}%`;
    return `${SUBJECTS[c.subject] || 'ID'} ${METRICS[c.metric]?.[0] || ''} ${METRICS[c.metric]?.[2] === 'bool' ? '' : `${c.min}～${c.max}${METRICS[c.metric]?.[2] || ''}`} ${c.not ? 'でない時' : 'である時'}`;
}
function skillsPage() {
    const u = current();
    const specialIds = new Set(Object.keys(u.specializedSkills || {}));
    const characterSpecialIds = new Set(config.units.flatMap(unit => Object.keys(unit.specializedSkills || {})));
    const matches = s => {
        const displayed = displayedSkillText(u, s);
        return skillMatchesKind(s, kindFilter) &&
            (displayed.name + s.name + displayed.baseName + displayed.note + displayed.original).toLowerCase().includes(skillSearch.toLowerCase());
    };
    const specials = config.skills.filter(s => specialIds.has(s.id) && matches(s) && skillFilter !== 'custom' &&
        (skillFilter !== 'equipped' || u.skills.includes(s.id)));
    const filtered = config.skills.filter(s => !specialIds.has(s.id) &&
        !(characterSpecialIds.has(s.id) && !isWikiSkill(s) && !u.skills.includes(s.id)) && matches(s) &&
        (skillFilter === 'all' || skillFilter === 'equipped' && u.skills.includes(s.id) || skillFilter === 'custom' && isCustomSkill(s)));
    const showAll = ['hp', 'ap', 'cleanse'].includes(kindFilter);
    if (showAll)
        skillPage = 0;
    else
        skillPage = Math.min(skillPage, Math.max(0, Math.ceil(filtered.length / 18) - 1));
    const start = showAll ? 0 : skillPage * 18, end = showAll ? filtered.length : Math.min((skillPage + 1) * 18, filtered.length);
    return heading('SKILL LIBRARY', 'スキルライブラリ', '2026/11/14までに実装のスキルを実装', btn('+ アクセルカレイド', 'new-skill', 'primary')) + `<div class="toolbar-secondary skill-target-toolbar">\
<label class="skill-target-select"><span class="skill-target-label">装備先</span>${unitSelect()}</label>${pill(`${u.skills.length} スキルをセット中`, 'green')}${unitTacticsControls()}</div>\
<div class="equipped-list">${u.skills.map(id => {
        const s = config.skills.find(s => s.id === id);
        return s ? btn(`${esc(displayedSkillName(u, s))} ×`, `equip:${id}`, '', 'aria-label="' + esc(displayedSkillName(u, s)) + 'を外す"') : '';
    }).join('')}</div><div class="searchbar"><input id="skill-search" type="search" placeholder="スキル名・効果で検索（例：炎、BS回復、迎撃）" value="${esc(skillSearch)}" aria-label="スキルを検索">${select({ all: 'すべての分類', ...SKILL_KINDS }, kindFilter, 'id="kind-filter" aria-label="スキル分類"')}${select({ all: 'すべて', equipped: 'セット中', custom: 'アクセルカレイド' }, skillFilter, 'id="skill-filter" aria-label="スキルの表示対象"')}</div>\
<div id="skill-result-area">${specials.length ? `<section class="specialized-skill-section" aria-label="このキャラの特殊化スキル"><div class="specialized-skill-header"><div><h2>このキャラの特殊化スキル <span>${nf(specials.length)}件</span></h2><p>名称・説明・効果原文はキャラクターごとに保存。戦闘性能は共通のスキル定義を参照します。</p></div></div><div class="skill-list" role="list"><div class="skill-list-head" aria-hidden="true"><span>特殊化名・元スキル</span><span>射程・対象</span><span>消費AP</span><span>消費行動値</span><span>効果</span><span>操作</span></div>${specials.map(s => skillCard(s, u, true)).join('')}</div></section>` : ''}<div class="skill-results-bar"><strong>共通ライブラリ ${nf(filtered.length)} 件</strong><span class="subtle">${filtered.length ? `${start + 1}～${end}件を表示` : '表示するスキルはありません'} · 効果全文は一覧で確認できます · その他の設定は「詳細」</span></div>\
<div class="skill-list" role="list" aria-label="スキル検索結果"><div class="skill-list-head" aria-hidden="true"><span>スキル</span><span>射程・対象</span><span>消費AP</span><span>消費行動値</span><span>効果</span><span>操作</span></div>${filtered.slice(start, end).map(s => skillCard(s, u)).join('')}</div>${!filtered.length ? '<div class="empty">条件に一致するスキルがありません。</div>' : ''}${showAll ? '' : `<div class="pagination">${btn('← 前へ', 'skill-prev', 'small', skillPage === 0 ? 'disabled' : '')}<span>${skillPage + 1} / ${Math.max(1, Math.ceil(filtered.length / 18))}</span>${btn('次へ →', 'skill-next', 'small', (skillPage + 1) * 18 >= filtered.length ? 'disabled' : '')}</div>`}</div>`;
}
// 表示専用の短縮表記。射程距離や実際の対象判定には影響しない。
const SKILL_RANGE_SHORT = {
    touch: '至', near: '近', mid: '中', far: '遠', super: '超', special: '特'
};
const SKILL_SCOPE_SHORT = {
    single: '単', random: '乱', self: '自', area: '範', wide: '域',
    selfArea: '自範', selfWide: '自域', pierce: '貫', cone: '扇', line: '列', special: '特'
};
function skillCard(s, u, specialized = false) {
    const equipped = u.skills.includes(s.id);
    const displayed = displayedSkillText(u, s);
    const name = displayed.name;
    const range = SKILL_RANGE_SHORT[s.range] || '―';
    const scope = SKILL_SCOPE_SHORT[s.scope] || '―';
    const fullRange = `${RANGES[s.range] || '未指定'}／${SCOPES[s.scope] || '未指定'}`;
    const effects = [
        ...(s.bs || []),
        ...Object.entries(s.effects || {}).filter(([key, value]) => !!value && key !== 'chargeTime').map(([key, value]) =>
            `${EFFECTS[key] || key}${FLAG_EFFECTS.has(key) ? '' : value}`)
    ];
    const charge = Number(s.effects?.chargeTime) || 0;
    const originalEffect = String(displayed.original || '').trim();
    // 公式スキルは原文の効果を省略せず表示する。独自スキルは全効果タグを表示する。
    // 詳細欄の原文を別行に重複させず、必ず消費行動値の右側の効果列に収める。
    const effectContent = originalEffect
        ? `<span class="skill-effect-fulltext">${esc(originalEffect)}</span>`
        : (effects.length
            ? effects.map(value => `<span class="skill-effect-chip">${esc(value)}</span>`).join('')
            : '<span class="skill-no-effects">―</span>');
    return `<article class="skill-entry ${equipped ? 'equipped' : ''}" role="listitem">\
<div class="skill-primary"><div class="skill-title-line"><span class="skill-kind-label ${esc(s.kind)}">${esc(SKILL_KINDS[s.kind] || s.kind)}</span><h3 title="${esc(name)}">${esc(name)}</h3>${equipped ? '<span class="skill-equipped-label">セット中</span>' : ''}</div>${specialized ? `<div class="specialized-base">元：${esc(displayed.baseName)}</div>` : ''}</div>\
<div class="skill-range-col" title="${esc(fullRange)}" aria-label="射程・対象：${esc(fullRange)}"><span class="skill-mobile-label">射程・対象</span><strong>${esc(range)}・${esc(scope)}</strong></div>\
<div class="skill-value-col"><span class="skill-mobile-label">消費AP</span><strong>${nf(s.ap)}</strong></div>\
<div class="skill-value-col"><span class="skill-mobile-label">消費行動値</span><strong>${nf(s.cost)}</strong>${charge ? `<small>溜 ${nf(charge)}</small>` : ''}</div>\
<div class="skill-effects-col" aria-label="スキル効果"><span class="skill-mobile-label">効果</span>${effectContent}</div>\
<div class="skill-row-actions">${btn(equipped ? '解除' : '＋ セット', `equip:${s.id}`, `small ${equipped ? 'skill-unequip' : 'primary'}`, `aria-label="${esc(name)}を${equipped ? 'セットから外す' : 'セットする'}"`)}${btn('詳細', `skill-detail:${s.id}`, 'small ghost', `aria-label="${esc(name)}の詳細"`)}</div>\
</article>`;
}
// The official 2026-11-16 Arena schema determines groups, labels and input limits.
// Legacy-only sort options are kept in a separate group for existing saved JSON.
function metricSelect(value, attrs) {
    return `<select ${attrs}>${['行動', '状態', 'パラメーター'].map(group => `<optgroup label="${group}">${ARENA_METRIC_ROWS.filter(x => x.group === group).map(x => `<option value="${x.key}" ${x.key === value ? 'selected' : ''}>${esc(x.condition_name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function officialRangeInputs(c, attr, label) {
    const spec = ARENA_CONDITION_SPECS[c.metric];
    if (!spec?.has_range) return '';
    const low = spec.range_min, high = spec.range_max;
    return `<input type="number" step="1" min="${low}" max="${high}" value="${esc(c.min ?? low)}" ${attr('min')} aria-label="${esc(label)}の下限">` +
        `<span>～</span><input type="number" step="1" min="${low}" max="${high}" value="${esc(c.max ?? high)}" ${attr('max')} aria-label="${esc(label)}の上限">` +
        `<span>${esc(spec.param_unit || '')}</span>`;
}
function resetOfficialMetric(c, key) {
    c.metric = key;
    const spec = ARENA_CONDITION_SPECS[key];
    // A new condition needs a usable inclusive range, while the JSON schema also permits omitted values.
    c.min = spec?.has_range ? (spec.range_min < 0 ? spec.range_min : 0) : 0;
    c.max = spec?.has_range ? spec.range_max : 100;
    if (!spec?.has_bs_list) c.bs = [];
}
function subjectSelector(c, attr) {
    const value = c.type === 'who' ? `who:${c.subject || 'enemies'}` : c.type;
    return `<select ${attr('selector')} aria-label="判定対象">${['対象', 'タイミング', 'その他'].map(group => {
        const rows = ARENA_SUBJECT_ROWS.filter(x => x.group === group);
        return `<optgroup label="${group}">${rows.map(x => `<option value="${x.has_sub_conditions ? 'who:' + x.key : x.key}" ${value === (x.has_sub_conditions ? 'who:' + x.key : x.key) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`;
    }).join('')}</select>`;
}
const selectedBsTitle = bs => !(bs || []).length ? '対象BS：すべて（未指定）' : `対象BS：${bs.length}種類選択中（${bs.slice(0, 3).join('、')}${bs.length > 3 ? ' ほか' : ''}）`;
function bsConditionChecklist(c, attr) {
    const chosen = new Set(c.bs || []);
    const allGroups = [...BS_GROUPS, BS_NAMES.filter(bs => !BS_GROUPS.some(group => group.includes(bs)))];
    return `<details class="bs-condition-chooser"><summary>${esc(selectedBsTitle(c.bs))}</summary><div class="bs-condition-panel"><p class="bs-condition-help">チェックしたBSだけを条件に含めます。すべて外すと全BSが対象です。</p>${allGroups.map((group, index) => `<fieldset class="bs-condition-family"><legend>${esc(index === BS_GROUPS.length ? 'その他' : group[0] + '系')}</legend><div class="bs-condition-options">${group.map(bs => `<label class="bs-condition-item"><input type="checkbox" value="${esc(bs)}" ${chosen.has(bs) ? 'checked' : ''} ${attr('bs')}><span>${esc(bs)}</span></label>`).join('')}</div></fieldset>`).join('')}</div></details>`;
}
function rosterPicker(value, attrs) {
    const known = Object.fromEntries(config.units.map(unit => [unit.id, `${unit.team}｜${unit.name}`]));
    if (value && !known[value]) known[value] = `不明なID: ${value}`;
    return select({ '': '対象キャラクターを選択', ...known }, value || '', attrs);
}
function conditionRow(c, ri, ci, isMove = false) {
    const attr = key => `data-${isMove ? 'move-condition' : 'condition'}="${ri}:${ci}:${key}" aria-label="ルール${ri + 1} ${isMove ? '移動' : '行動'}条件${ci + 1} ${key}"`;
    const meta = ARENA_SUBJECT_ROWS.find(x => x.key === c.subject);
    const who = c.type === 'who';
    return `<div class="condition-row"><span class="join">${ci ? 'AND' : 'IF'}</span>${subjectSelector(c, attr)}` +
        (who ? `${meta?.has_character_id ? rosterPicker(c.characterId, attr('characterId')) : ''}` +
        `${meta?.is_multiple_character ? `<span>${c.not ? 'のうち誰も' : 'のうち誰か'}</span>` : ''}` +
        `${metricSelect(c.metric, attr('metric'))}${ARENA_CONDITION_SPECS[c.metric]?.has_bs_list ? bsConditionChecklist(c, attr) : ''}${officialRangeInputs(c, attr, '発動条件')}` :
            c.type === 'turn' ? `<select ${attr('multiple')}>${Array.from({length:10},(_,i)=>i+1).map(n=>`<option value="${n}" ${Number(c.multiple) === n ? 'selected' : ''}>${n}の倍数（×0含む）＋</option>`).join('')}</select><input type="number" step="1" min="0" value="${esc(c.offset ?? 0)}" ${attr('offset')}><span>ターン目</span>` :
            c.type === 'chance' ? `<input type="number" step="1" min="0" max="100" value="${esc(c.chance ?? 50)}" ${attr('chance')}><span>％の確率で</span>` : '') +
        `${c.type !== 'chance' ? select({ false: 'である時', true: 'ではない時' }, String(!!c.not), attr('not')) : ''}${btn('×', `${isMove ? 'remove-move-condition' : 'remove-condition'}:${ri}:${ci}`, 'small ghost remove', 'aria-label="この条件を削除"')}</div>`;
}
function targetConditionRow(c, ri, ci) {
    const attr = key => `data-target-condition="${ri}:${ci}:${key}" aria-label="ルール${ri + 1} 対象選択${ci + 1} ${key}"`;
    const choice = c.type === 'sort' ? `sort:${c.sort || 'nearest'}` : `filter:${c.metric || 'hpPct'}`;
    const officialFilters = ARENA_METRIC_ROWS.filter(row => row.has_range && row.target_name && row.target_name !== '-');
    const legacyFilters = ARENA_METRIC_ROWS.filter(row => !row.has_range && !ARENA_SORT_ROWS.some(x => x.key === row.key));
    const legacySorts = Object.entries(TARGET_SORTS).filter(([key]) => !ARENA_SORT_ROWS.some(x => x.key === key));
    const choices = `<select ${attr('choice')} aria-label="対象選択${ci + 1}の条件">`+
       `<optgroup label="追加条件">${officialFilters.map(row => `<option value="filter:${row.key}" ${choice === `filter:${row.key}` ? 'selected' : ''}>${esc(row.target_name)}</option>`).join('')}</optgroup>`+
       `<optgroup label="優先条件">${ARENA_SORT_ROWS.map(row => `<option value="sort:${row.key}" ${choice === `sort:${row.key}` ? 'selected' : ''}>${esc(row.target_name)}</option>`).join('')}</optgroup>`+
       (legacyFilters.length ? `<optgroup label="従来の追加条件">${legacyFilters.map(row => `<option value="filter:${row.key}" ${choice === `filter:${row.key}` ? 'selected' : ''}>${esc(row.condition_name)}</option>`).join('')}</optgroup>` : '') +
       (legacySorts.length ? `<optgroup label="従来の追加オプション">${legacySorts.map(([key,label])=>`<option value="sort:${key}" ${choice === `sort:${key}` ? 'selected' : ''}>${esc(label)}</option>`).join('')}</optgroup>` : '') + `</select>`;
    const filter = c.type === 'filter';
    const inputs = filter ? `${ARENA_CONDITION_SPECS[c.metric]?.has_bs_list ? bsConditionChecklist(c, attr) : ''}${officialRangeInputs(c, attr, '対象条件')}${select({false: 'である者', true: 'ではない者'}, String(!!c.not), attr('not'))}` : '';
    return `<div class="condition-row target-condition-row"><span class="join">${filter ? '絞込' : '優先'}</span>${choices}${inputs}${btn('×', `remove-target-condition:${ri}:${ci}`, 'small ghost remove', 'aria-label="対象選択の条件を削除"')}</div>`;
}
function rulesPage() {
    const u = current();
    return heading('ACTION RULE BUILDER', 'キャラAI設定（β版）', '公式アリーナの条件・行動・対象・位置取り定義（2026年11月16日取得）に準拠。上から順に判定します。', btn('AI設定追加', 'add-rule', 'primary', u.rules.length >= ARENA_MAX_RULES ? 'disabled title="公式の最大20件"' : '')) + (arenaImportReport && arenaImportReport.unitId === u.id ? `<section class="notice arena-import-report">\
<strong>公式アリーナの戦術を読み込みました：${arenaImportReport.ruleCount}ルール</strong>\
<p>未解決のスキル・ID指定を含むルールは無効化しています。内容を確認してから有効にしてください。</p>${arenaImportReport.warnings.length ? `<details>\
<summary>変換時の注意（${arenaImportReport.warnings.length}件）</summary>\
<ul>${arenaImportReport.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>\
</details>` : ''}</section>` : '') + `<div class="toolbar-secondary tactics-toolbar">${unitSelect()}<span class="subtle">${u.rules.length} ルール · ↑↓ で優先順位を変更</span>${unitTacticsControls()}</div>\
<div class="rule-layout"><div>${u.rules.map((r, i) => ruleCard(r, i, u)).join('')}${btn('AI設定追加', 'add-rule', '', `style="width:100%" ${u.rules.length >= ARENA_MAX_RULES ? 'disabled title="公式の最大20件"' : ''}`)}</div>\
</div>`;
}
function movementSettings(r, i, u) {
    const attr = k => `data-rule="${i}:${k}"`;
    if (['wait', 'carry'].includes(r.action))
        return '';
    const split = !!r.splitMovement;
    const mode = r.moveTargetMode || 'same';
    return `<div class="movement-split">
  <label class="checkbox-label"><input type="checkbox" ${split ? 'checked' : ''} ${attr('splitMovement')}>行動対象と移動基準を分ける</label>
  ${split ? `<div class="movement-split-body">
   <div class="movement-split-fields">${field('移動基準', select({ same: '行動対象と同じ', individual: '個別に指定' }, mode, attr('moveTargetMode')))}</div>
   ${mode === 'individual' ? `<div class="movement-split-fields">${field('移動基準の対象', select({
        previous: '条件該当者',
        all: '敵味方',
        allies: '自陣営',
        companions: '同行者',
        enemies: '敵',
        self: '自身',
        id: 'ID'
    }, r.moveSubject || 'previous', attr('moveSubject')))}
    ${r.moveSubject === 'id' ? field('指定ID', select(Object.fromEntries(config.units.map(v => [v.id, `${v.team}｜${v.name}`])), r.moveUnitId || '', attr('moveUnitId'))) : ''}
    ${field('移動基準の優先条件', select(TARGET_SORTS, r.moveSort || 'nearest', attr('moveSort')))}${field('行動と移動の優先', select({ action: '行使優先', movement: '移動優先' }, r.movePriority || 'action', attr('movePriority')))}</div>
    <div class="movement-extra-conditions"><div class="move-conditions-title">移動基準の追加条件</div>
    ${(r.moveConditions || []).map((c, j) => conditionRow(c, i, j, true)).join('')}
    ${btn('+ 追加条件', `add-move-condition:${i}`, 'small ghost', (r.moveConditions || []).length >= ARENA_MAX_CONDITIONS ? 'disabled' : '')}
    <p class="rule-help">追加条件は通常の条件と同じ項目・範囲を使用できます。「前の条件を満たす対象」は移動基準の候補を参照します。</p>
    </div>` : ''}
  </div>` : ''}
 </div>`;
}
function ruleCard(r, i, u) {
    const attr = k => `data-rule="${i}:${k}"`;
    const focusAction = ['focusAttack', 'focusDefense'].includes(r.action);
    return `<article class="rule-card ${r.enabled ? '' : 'disabled'} ${mobileExpandedRules.has(i) ? '' : 'mobile-collapsed'}" data-mobile-rule="${i}"><div class="rule-head"><div class="rule-title"><span class="num">${String(i + 1).padStart(2, '0')}</span>\
<label class="checkbox-label"><input type="checkbox" ${r.enabled ? 'checked' : ''} ${attr('enabled')}>\
適用</label></div><div class="btnrow">${btn('↑', `up-rule:${i}`, 'small ghost', i === 0 ? 'disabled aria-label="優先順位を上げる"' : 'aria-label="優先順位を上げる"')}${btn('↓', `down-rule:${i}`, 'small ghost', i === u.rules.length - 1 ? 'disabled aria-label="優先順位を下げる"' : 'aria-label="優先順位を下げる"')}${btn('複製', `clone-rule:${i}`, 'small ghost')}${btn('削除', `delete-rule:${i}`, 'small ghost danger')}</div>${btn(mobileExpandedRules.has(i) ? '閉じる' : '開く', `toggle-mobile-rule:${i}`, 'small mobile-rule-toggle', `aria-expanded="${mobileExpandedRules.has(i)}" aria-label="ルール${i + 1}の編集欄を${mobileExpandedRules.has(i) ? '閉じる' : '開く'}"`)}<div class="mobile-rule-summary">${esc(ACTIONS[r.action] || r.action)} ／ ${r.conditions.length ? `条件${r.conditions.length}件` : '無条件'} ／ ${esc(({enemies:'敵',allies:'味方',self:'自身',all:'全員',previous:'条件該当者'})[r.target] || r.target)}</div></div>
 <div class="rule-body">${r.conditions.length ? r.conditions.map((c, ci) => conditionRow(c, i, ci)).join('') : '<div class="subtle" style="padding:7px 0">無条件で評価します。</div>'}
 ${btn('+ 条件を追加', `add-condition:${i}`, 'small ghost', r.conditions.length >= ARENA_MAX_CONDITIONS ? 'disabled title="公式の最大5条件"' : '')}
 <div class="rule-action">${field('THEN / 行動', select(ARENA_ACTION_CHOICES, r.action, attr('action')))}
 ${r.action === 'skill' ? field('使用スキル', select({ '': 'スキルを選択', ...Object.fromEntries(u.skills.map(id => config.skills.find(s => s.id === id)).filter(s => s && s.kind !== 'passive').map(s => [s.id, displayedSkillName(u, s)])) }, r.skillId, attr('skillId'))) : ''}
 ${focusAction ? field('行動対象', '<select disabled aria-label="行動対象（自身に固定）"><option>自身（集中）</option></select>') : field(r.splitMovement ? '行動対象' : '対象', select(Object.fromEntries([
        ['previous', '条件該当者'], ['all', '敵味方'], ['self', '自身'],
        ['allies', '自陣営'], ['companions', '同行者'], ['enemies', '敵'], ['id', 'ID']
    ]), r.target, attr('target')))}${!focusAction && r.target === 'id' ? field('対象ID', rosterPicker(r.targetUnitId, attr('targetUnitId'))) : ''}
 </div>${focusAction ? '' : `<div class="target-extra-conditions"><div class="move-conditions-title">対象の条件・優先順位（同じプルダウンから選択）</div>${targetCriteriaForRule(r).map((c, j) => targetConditionRow(c, i, j)).join('')}${btn('+ 対象条件を追加', `add-target-condition:${i}`, 'small ghost')}<p class="rule-help">\
追加条件は全てANDで候補を絞り、優先条件は上から順に比較します。</p></div>`}
 ${movementSettings(r, i, u)}
 ${!['wait', 'carry'].includes(r.action) && (!focusAction || r.splitMovement) ? `<div class="move-options">${field('自動位置取り', select({ true: 'する（消費行動値＋40/50/65/85）', false: 'しない' }, String(r.autoMove), attr('autoMove')))}
 ${r.autoMove || r.action === 'move' ? `${field('移動方法', select(Object.fromEntries(OFFICIAL_MOVE_ROWS.map(row => [row.key, row.name])), r.moveMode, attr('moveMode')))}
 ${r.moveMode === 'fixed' ? field('対象からの距離 (m)', `<div class="btnrow"><input type="number" min="0" max="999" step="1" value="${r.minDist ?? ''}" ${attr('minDist')} aria-label="移動距離の下限">\
<span>～</span><input type="number" min="0" max="999" step="1" value="${r.maxDist ?? ''}" ${attr('maxDist')} aria-label="移動距離の上限">\
</div><span class="subtle">${focusAction ? '両方空欄：移動基準から3m以内を目標（集中にスキル射程はありません）' : '両方空欄：スキルの有効射程へ自動移動'}</span>`) : ''}` : ''}</div>` : ''}
 <p class="rule-help">${focusAction ? (r.splitMovement ? '集中は自身に適用します。移動基準を「個別に指定」、優先を「移動優先」、自動位置取りを「する」にすると、対象への位置取り後に集中します（通常移動は機動力×10m、行動値＋40）。' : '集中は自身に適用し、位置取りを行いません。') : (r.autoMove || r.action === 'move' ? '通常移動は機動力×10m（行動値＋40）。射程外なら追加で最大30m、10mごとに行動値＋10・＋15・＋20を累積加算。なお射程に届かない場合は移動のみ。' : '現在位置で実行します。')}${!focusAction && r.splitMovement && r.moveTargetMode === 'individual' ? ' 行使優先は現在位置で行動できる場合に移動を省略します。移動優先は移動基準への位置取りを先に試みます。' : ''}${r.action === 'effectiveAttack' ? ' 実行可能な攻撃の概算威力を比較します。' : ''}</p>
 </div></article>`;
}
function simPage() {
    const result = sim?.result();
    const stale = sim && JSON.stringify(config) !== JSON.stringify(sim.config);
    const a = config.units.filter(u => u.team === 'A').length, b = config.units.filter(u => u.team === 'B').length;
    return `<div class="sim-page-heading"><div class="sim-page-title"><h1>シミュレーション</h1><p class="subtitle">実行ごとに乱数を自動で更新します。</p></div><div class="sim-settings"><div class="sim-settings-fields">${field('乱数', select({ auto: '毎回自動（通常）', fixed: 'シード固定（再現用）' }, config.settings.seedMode, 'data-settings="seedMode"'))}${config.settings.seedMode === 'fixed' ? field('再現用シード', `<input data-settings="seed" value="${esc(config.settings.seed)}">`) : ''}${field('ターン制限', '<div class="fixed-turns">サドンデス込 25T</div>')}</div><div class="sim-settings-actions">${btn('リセット', 'reset-sim', '', !sim ? 'disabled' : '')}${btn('1ターン進める', 'step', '', busy || (sim?.done && !stale) ? 'disabled' : '')}${btn(`${icon('sim', 'inline-icon')}${sim && !sim.done ? '最後まで実行' : 'シミュレーション実行'}`, 'run', 'primary', busy ? 'disabled' : '')}</div></div></div>${stale ? '<div class="notice">設定が変更されています。表示中の結果は変更前のものです。次の実行時に初期状態から再計算します。</div>' : ''}${batchPanel()}${!sim ? `<div class="result-grid">\
<section class="panel"><div class="panel-head"><h2>対戦プレビュー</h2>${pill(`${a} vs ${b}`, 'green')}</div>\
<div class="panel-body">${map(config.units, true)}</div>\
</section><section class="empty-state"><div class="big-icon">${icon('sim')}</div>${btn('シミュレーション実行', 'run', 'primary')}<p class="footnote">\
設定変更後の実行は、初期状態から再計算します。</p></section></div>` : resultView(result)}`;
}

function batchPanel() {
    return `<details class="panel" style="margin-bottom:20px" ${batch || worker ? 'open' : ''}><summary style="cursor:pointer;padding:15px 20px;font-size:12px;font-weight:600">\
連続実行の結果を一括表示（勝率算出用）</summary><div class="panel-body" style="padding-top:0"><div class="batch-controls">${field('試行回数', select({ 10: '10回', 50: '50回', 100: '100回', 500: '500回' }, batchCount, 'id="batch-count" aria-label="試行回数"'))}${btn(worker ? '計算中…' : '一括シミュレーション', 'batch', 'primary', worker ? 'disabled' : '')}${worker ? btn('中止', 'cancel-batch') : ''}<span class="subtle" id="batch-progress">${worker ? '計算中' : ''}</span>\
</div>${batch ? `<div class="batch-summary">\
<div class="batch-bar"><i class="a" style="width:${batch.A / batch.n * 100}%">\
</i><i class="draw" style="width:${batch.draw / batch.n * 100}%">\
</i><i class="b" style="width:${batch.B / batch.n * 100}%">\
</i></div><div class="btnrow">${pill(`A勝利 ${(batch.A / batch.n * 100).toFixed(1)}% (${batch.A})`, 'green')}${pill(`B勝利 ${(batch.B / batch.n * 100).toFixed(1)}% (${batch.B})`, 'red')}${pill(`引き分け ${batch.draw}`)}<span class="subtle">${batch.n}回 / 平均 ${batch.meanTurns.toFixed(1)}ターン</span>\
</div><p class="footnote">各試行には「シード:#連番」を使用。通常20ターン＋サドンデス5ターン終了時の決着・相打ちは、与ダメージ・クリーンヒット以上・残HP割合で判定します。</p></div>` : ''}</div>\
</details>`;
}
function resultView(r) {
    frame = frame < 0 ? r.frames.length - 1 : Math.min(frame, r.frames.length - 1);
    const teams = teamBattleStats(r.units);
    const teamRows = metric => ['A', 'B'].map(team => `<div class="kpi-team-row"><span class="kpi-team-label ${team === 'B' ? 'enemy' : ''}">\
TEAM ${team}</span>\
<strong>${nf(teams[team][metric])}</strong>\
</div>`).join('');
    const tb = r.tiebreak;
    const tiePanel = tb ? `<section class="panel tiebreak-panel"><div class="panel-head"><h2>引き分け時の勝敗判定</h2><span class="tiebreak-total">\
TEAM A ${tb.points.A}点 / TEAM B ${tb.points.B}点</span>\
</div><div class="panel-body"><div class="tiebreak-grid"><div class="tiebreak-caption">比較項目</div><div class="tiebreak-caption">TEAM A</div>\
<div class="tiebreak-caption">TEAM B</div>${[['damage', '与ダメージ', n => nf(n)], ['cleanHits', 'クリーンヒット以上', n => nf(n)], ['hpRatio', '残HP割合', n => (n * 100).toFixed(2) + '%']].map(([key, label, fmt]) => `<div class="tiebreak-name">${label}</div>${['A', 'B'].map(team => `<div class="tiebreak-value ${tb.votes[key] === team ? 'point-awarded' : ''}">${fmt(tb.values[team][key])}${tb.votes[key] === team ? '<b>+1</b>' : ''}</div>`).join('')}`).join('')}</div>\
<p class="footnote">各項目で数値の高いチームに1点。同点なら加点なし。残HP割合はチーム全員の残HP合計÷最大HP合計です。</p></div></section>` : '';
    return `<div class="kpi-grid"><div class="kpi"><small>結果</small><strong>${r.done ? (r.winner === 'draw' ? '引き分け' : `TEAM ${r.winner} 勝利`) : '戦闘中'}</strong>\
<span>今回のシード ${esc(r.seed)}</span>\
</div><div class="kpi"><small>ターン</small><strong>${r.turns}<span style="font-size:12px;color:var(--muted)">\
 / ${sim.config.settings.turns}</span>\
</strong><span>${r.done ? 'シミュレーション終了' : '次のターンへ進行可能'}</span>\
</div><div class="kpi"><small>与ダメージ</small><div class="kpi-team-stats">${teamRows('damage')}</div>\
<span class="kpi-hint">敵チームへ与えたダメージ</span></div><div class="kpi"><small>クリーンヒット以上</small><div class="kpi-team-stats">${teamRows('cleanHits')}</div>\
<span class="kpi-hint">クリーン・ハード・スマッシュの合計</span></div></div>${tiePanel}${r.warnings.length ? `<div class="notice">${r.warnings.map(esc).join('<br>')}</div>` : ''}<div class="result-grid replay-layout">\
<aside class="replay-sidebar"><section class="panel"><div class="panel-head"><h2>対戦プレビュー</h2></div><div class="panel-body"><p id="replay-label" class="replay-label">\
</p><div id="replay-map"></div><div class="btnrow" style="margin-top:13px"><span class="subtle">初期</span><input id="frame-range" type="range" min="0" max="${r.frames.length - 1}" value="${frame}" aria-label="リプレイ時点" style="flex:1;width:150px">\
<span class="subtle">最新</span></div></div></section><section class="panel">\
<div class="panel-head"><h2>ユニットの状態</h2>${btn('結果JSON', 'export-result', 'small ghost')}</div>\
<div id="replay-units" class="panel-body"></div></section></aside><section class="panel replay-log-panel"><div class="panel-head"><h2>\
戦闘ログ</h2>${btn('ログを書き出す', 'export-log', 'small')}</div>\
<div class="panel-body" style="padding-top:14px;padding-bottom:14px"><div class="log-toolbar">${select({
        main: '主要な行動',
        all: '詳細すべて',
        condition: '条件判定のみ',
        damage: 'ダメージのみ',
        heal: '回復のみ'
    }, logType, 'id="log-type" aria-label="ログ種別"')}${select({ all: '全ターン', ...Object.fromEntries(Array.from({ length: r.turns }, (_, i) => [i + 1, `第${i + 1}ターン`])) }, logTurn, 'id="log-turn" aria-label="ログのターン"')}<input id="log-search" placeholder="ログを検索" value="${esc(logSearch)}" aria-label="戦闘ログを検索">\
<span class="subtle">${r.logs.length.toLocaleString()}件</span>\
</div></div><div id="log-entries" class="logs" tabindex="0" aria-label="戦闘ログ。スクロールするとマップが連動します">${logEntries()}</div>\
</section></div>`;
}
function visibleLogs() {
    return !sim ? [] : sim.logs.filter(l => (logTurn === 'all' || l.turn === Number(logTurn)) && (logType === 'all' || logType === 'main' && !['condition', 'actionEnd', 'reserve'].includes(l.type) || logType === l.type || logType === 'damage' && (['pursuit', 'suddenDamage'].includes(l.type) || l.type === 'bs' && l.message.includes('障壁が'))) && (!logSearch || (l.message + ' ' + l.detail + ' ' + (l.tags || []).map(t => t.label).join(' ')).includes(logSearch)));
}
function logEntries() {
    const logs = visibleLogs(), types = {
        action: '行動',
        turn: 'ターン',
        sudden: 'サドンデス',
        suddenDamage: 'サドンデス',
        damage: 'ダメージ',
        pursuit: '追撃',
        heal: '回復',
        skill: 'スキル',
        condition: '条件',
        reserve: '行動予約',
        actionEnd: '残行動値',
        speed: 'ターン開始時',
        carry: '持ち越し',
        miss: '回避',
        bs: 'BS',
        buff: '付与',
        wait: '待機',
        move: '移動',
        drama: 'ドラマ',
        down: '戦闘不能',
        effect: '特殊効果',
        result: '結果'
    };
    return logs.slice(-700).map(l => `<div class="log ${l.type}${selectedLogId === l.id ? ' selected-log' : ''}" role="button" tabindex="0" data-log-id="${l.id}" data-act="select-log:${l.id}" aria-pressed="${selectedLogId === l.id}">\
<span class="time">T${String(l.turn).padStart(2, '0')}<span class="time-gauge">${['speed', 'sudden', 'suddenDamage'].includes(l.type) ? '開始時' : `残行動値 ${Math.floor(l.gauge)}`}</span></span>\
<span class="type">${combatLogTypeLabel(l.type, l.message) || types[l.type] || l.type}</span>\
<div>${esc(l.message)}${l.tags?.length ? `<div class="log-tags">${l.tags.map(tag => `<span class="log-tag tag-${[
        'buff',
        'splash',
        'weak',
        'status',
        'result'
    ].includes(tag.kind) ? tag.kind : 'other'}">${esc(tag.label)}</span>`).join('')}</div>` : ''}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ''}</div>\
</div>`).join('') + (!logs.length ? '<div class="empty">一致するログがありません。</div>' : '') + (logs.length > 700 ? '<p class="footnote">表示は最新700件です。全件はログ書き出しから保存できます。</p>' : '');
}
function replayUnits(units) {
    return `<div class="combatants replay-teams">${groupReplayUnitsByTeam(units).map(({ team, units: members }) => `<section class="replay-team ${team === 'B' ? 'enemy' : ''}" aria-label="TEAM ${team}のユニットの状態">\
<div class="replay-team-head"><strong>TEAM ${team} <span>${team === 'A' ? '自チーム' : '相手チーム'}</span>\
</strong><small>${members.length}人</small>\
</div><div class="replay-team-members">${members.map((u, index) => `<div class="combatant">\
<span class="avatar ${team === 'B' ? 'enemy' : ''}">${team}${index + 1}</span>\
<div><div class="name">${esc(u.name)} ${u.alive ? '' : pill('戦闘不能', 'red')}</div>\
<div class="numbers"><span>HP ${nf(u.hp)} / ${nf(u.maxHp)}</span>\
<span>AP ${nf(u.ap)}</span>${u.barrier > 0 ? `<span class="replay-barrier">障壁 ${nf(u.barrier)}</span>` : ''}\
</div><div class="hpbar"><i style="width:${clamp(u.hp / u.maxHp * 100, 0, 100)}%">\
</i></div><div class="apbar"><i style="width:${u.maxAp ? clamp(u.ap / u.maxAp * 100, 0, 100) : 0}%">\
</i></div><p class="subtle">座標 (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) m</p>${u.bs.length ? `<div class="skill-tags">${u.bs.filter(b => b.remaining > 0).map(b => pill(bsStatusLabel(b), 'gold')).join('')}</div>` : ''}</div>\
<div class="damage">${nf(u.damageDealt)}<small>\
与ダメージ</small></div></div>`).join('') || '<p class="subtle replay-team-empty">ユニットはいません。</p>'}</div>\
</section>`).join('')}</div>`;
}
function paintReplay() {
    if (!sim || !$('#replay-map'))
        return;
    const f = sim.frames[frame] || sim.frames.at(-1), log = sim.logs.find(l => l.id === selectedLogId);
    $('#replay-map').innerHTML = map(f.units, true);
    refreshMobileReplayMap(f.units);
    repaintExpandedMap();
    $('#replay-units').innerHTML = replayUnits(f.units);
    $('#replay-label').textContent = log ? `T${String(log.turn).padStart(2, '0')} / ${['speed', 'sudden', 'suddenDamage'].includes(log.type) ? '開始時' : `残行動値 ${Math.floor(log.gauge)}`}｜${log.message}` : f.label;
    $('#frame-range').value = frame;
    $('#log-entries')?.querySelectorAll('[data-log-id]').forEach(el => {
        const active = Number(el.dataset.logId) === selectedLogId;
        el.classList.toggle('selected-log', active);
        el.setAttribute('aria-pressed', String(active));
    });
}
function selectLog(id) {
    const log = sim?.logs.find(l => l.id === Number(id));
    if (!log || !Number.isInteger(log.frameIndex))
        return;
    selectedLogId = log.id;
    frame = log.frameIndex;
    paintReplay();
}
function syncMapToVisibleLog() {
    const box = $('#log-entries');
    if (!box)
        return;
    const rows = [...box.querySelectorAll('[data-log-id]')];
    if (!rows.length)
        return;
    // At the very bottom the last log is normally BELOW the viewport's top edge.
    // Select it explicitly, or long final log messages will keep the replay behind.
    const atBottom = box.scrollHeight - box.clientHeight - box.scrollTop <= 3;
    const row = atBottom ? rows.at(-1) : rows.find(el => el.getBoundingClientRect().bottom > box.getBoundingClientRect().top + 8) || rows.at(-1);
    selectLog(Number(row.dataset.logId));
    if (atBottom && sim.logs.at(-1)?.id === Number(row.dataset.logId)) {
        // endTurn() can add a final frame without creating a log entry.
        frame = sim.frames.length - 1;
        paintReplay();
    }
}
function bindReplay() {
    const box = $('#log-entries');
    if (!box)
        return;
    box.scrollTop = logScrollTop === null ? box.scrollHeight : logScrollTop;
    syncMapToVisibleLog();
    paintReplay();
    scheduleMobileReplayMapVisibility();
    box.addEventListener('scroll', () => {
        logScrollTop = box.scrollTop;
        cancelAnimationFrame(logScrollFrame);
        logScrollFrame = requestAnimationFrame(syncMapToVisibleLog);
    }, { passive: true });
}
function refreshLogList() {
    const box = $('#log-entries');
    if (!box)
        return;
    box.innerHTML = logEntries();
    box.scrollTop = 0;
    logScrollTop = 0;
    syncMapToVisibleLog();
}
function namedField(label, key, value, type = 'number') {
    const attrs = type === 'text' ? `type="text" maxlength="100"` : `type="number" step="any"`;
    const control = type === 'textarea' ? `<textarea data-draft="${esc(key)}" rows="3">${esc(value ?? '')}</textarea>` : `<input ${attrs} data-draft="${esc(key)}" value="${esc(value ?? '')}">`;
    return field(esc(label), control);
}
function effectEditor(group, labels, title) {
    const effects = modalDraft?.[group] || {};
    const entries = Object.entries(effects).filter(([key]) => key in labels);
    const rows = entries.map(([key, value]) => `<div class="effect-edit-row">
 ${select(labels, key, `data-effect-key="${esc(group)}:${esc(key)}" aria-label="${esc(title)}の種類"`)}
 ${FLAG_EFFECTS.has(key) ? '<span class="effect-no-value">数値入力不要</span>' : `<input type="number" step="any" data-effect-value="${esc(group)}:${esc(key)}" value="${esc(value)}" aria-label="${esc(key)}の効果量">`}
 ${btn('削除', `remove-effect:${group}:${key}`, 'small danger')}
 </div>`).join('');
    return `<div class="effect-editor"><div class="field-section">${esc(title)}</div>${rows}${Object.keys(labels).some(key => !(key in effects)) ? btn('＋ 効果を追加', `add-effect:${group}`, 'small ghost') : ''}</div>`;
}
function openSkill(id, copy = false) {
    const s = config.skills.find(s => s.id === id);
    modalMode = 'skill';
    if (isReadOnlySkill(s) && !copy) {
        const characterText = displayedSkillText(current(), s);
        $('#modal').innerHTML = `<div class="modal-header"><div><div class="eyebrow">SKILL REFERENCE</div><h2>${esc(displayedSkillName(current(), s))}</h2>\
</div>${btn('×', 'close-modal', 'ghost', 'aria-label="閉じる"')}</div>\
<div class="modal-form doc"><div class="skill-tags">${pill(SKILL_KINDS[s.kind], 'green')}${pill(`AP ${s.ap}`)}${pill(`行動値 ${s.cost}`)}${pill(RANGES[s.range])}</div>\
<p style="margin:14px 0">${esc(characterText.note)}</p>\
<div class="source-quote">${esc(characterText.original)}</div>\
<div style="margin-top:18px"><span class="subtle">取得条件</span><p style="font-size:12px">${esc(s.requirements || '条件なし')}</p>\
</div></div><div class="modal-footer">${btn('複製して編集', `copy-skill:${s.id}`)}${btn(current().skills.includes(s.id) ? 'セットを外す' : 'このユニットにセット', `modal-equip:${s.id}`, 'primary')}</div>`;
        $('#modal').showModal();
        return;
    }
    modalDraft = s ? clone(s) : freshSkill({ id: uid('acc') });
    const characterText = s ? displayedSkillText(current(), s) : null;
    if (copy)
        modalDraft = copyAsCustom(s);
    adaptAccelDraft(modalDraft);
    modalDraft.castMods ??= {};
    modalDraft.grantedEffects ??= {};
    modalDraft.selfModifiers ??= {};
    modalDraft.selfEffects ??= {};
    modalDraft.elementCorrection ??= 0;
    renderModal();
    if (characterText && current().specializedSkills?.[s.id] && !copy) {
        const modalForm = $('#modal .modal-form');
        modalForm.insertAdjacentHTML('afterbegin', `<div class="specialized-modal-reference"><strong>このキャラの特殊化：${esc(characterText.name)}</strong><div>元スキル：${esc(characterText.baseName)}</div>${characterText.note ? `<p>${esc(characterText.note)}</p>` : ''}${characterText.original ? `<p class="source-quote">${esc(characterText.original)}</p>` : ''}</div>`);
    }
    $('#modal').showModal();
}
function renderModal() {
    if (modalMode === 'unit') {
        $('#modal').innerHTML = `<div class="modal-header"><h2>${esc(current().name)}の固有効果</h2>${btn('×', 'close-modal', 'ghost')}</div>\
<div class="modal-form"><p class="subtle">数値を使わない効果は、選択するだけで有効になります。</p>${effectEditor('effects', EFFECTS, '固有の特殊効果')}</div>\
<div class="modal-footer">${btn('キャンセル', 'close-modal')}${btn('保存', 'save-unit-effects', 'primary')}</div>`;
        return;
    }
    const s = modalDraft;
    const category = accelCategory(s.kind), healing = category === 'heal', attacking = category === 'attack', buffing = category === 'buff';
    const effectsList = accelEffects(s.kind);
    $('#modal').innerHTML = `<div class="modal-header"><div><div class="eyebrow">ACCEL KALEIDO</div><h2>${!config.skills.some(v => v.id === s.id) ? 'アクセルカレイドを作成' : 'アクセルカレイドを編集'}</h2>\
</div>${btn('×', 'close-modal', 'ghost', 'aria-label="閉じる"')}</div>
 <div class="modal-form">
  <div class="fields two">${namedField('スキル名', 'name', s.name, 'text')}
   ${field('分類', select(ACCEL_KINDS, category, 'data-draft-category aria-label="スキルの分類"'))}
   ${namedField('消費AP', 'ap', s.ap)}${namedField('消費行動値（溜を含めない）', 'cost', s.cost)}
   ${field('射程', select(ACCEL_RANGES, s.range, 'data-draft="range"'))}
   ${field('効果範囲', select(ACCEL_SCOPES, s.scope, 'data-draft="scope"'))}
   ${attacking ? namedField('スキル固有の任意ダメージ補正 (%)', 'elementCorrection', s.elementCorrection || 0) : ''}
  </div>
  ${attacking ? `<div class="field-section">威力・命中</div><div class="fields three">${namedField('主攻撃力に加算', 'mainBonus', s.mainBonus)}${namedField('副攻撃力に加算', 'subBonus', s.subBonus)}${namedField('命中に加算', 'hitBonus', s.hitBonus)}${namedField('主攻撃力の使用率 (%)', 'mainPct', s.mainPct)}${namedField('副攻撃力の使用率 (%)', 'subPct', s.subPct)}</div>` : ''}
  ${healing ? `<div class="field-section">回復量</div>${field('回復力に加算する威力', `<input type="number" step="any" data-draft="power" value="${esc(s.power)}">`)}` : ''}
  <details class="accordion" open><summary>特殊効果${attacking ? '・BS' : ''}</summary>
   <p class="subtle" style="margin-top:10px">数値を使わない効果は、選択するだけで有効になります。</p>
   ${healing ? field('回復の特殊効果', select(ACCEL_HEAL_MODES, s.kind, 'data-heal-mode aria-label="回復の特殊効果"')) : ''}
   ${attacking ? field('迎撃・報復', select({ instant: '通常発動', intercept: '迎撃', retaliate: '報復' }, s.trigger, 'data-draft="trigger"')) : ''}
   ${!attacking ? '<p class="subtle">範囲回復・範囲付与は「識別」がない場合、敵味方両方に効果が及びます。</p>' : ''}
   ${effectEditor('effects', effectsList, 'このスキルの特殊効果')}
   ${attacking ? `<div class="fields two" style="margin-top:15px">${field('命中時に与えるBS（複数選択可／基本3ターン）', `<select multiple class="multi-bs" data-draft-bs>${BS_NAMES.map(b => `<option ${(s.bs || []).includes(b) ? 'selected' : ''}>${b}</option>`).join('')}</select>`)}</div>` : ''}
   ${healing && s.kind === 'cleanse' ? '<p class="subtle">BS回復の成功率は、上記「BS回復」の効果量（%）で指定できます。</p>' : ''}
  </details>
  <details class="accordion"><summary>能力補正・付与・自分付与</summary>
   ${effectEditor('castMods', { critical: 'クリティカル', fumble: 'ファンブル' }, '使用時のみ加算')}
   ${effectEditor('modifiers', GRANT_STAT_LABELS, '対象への能力付与')}
   ${effectEditor('grantedEffects', buffing ? ACCEL_BUFF_EFFECTS : effectsList, '対象へ付与する特殊効果')}
   ${effectEditor('selfModifiers', GRANT_STAT_LABELS, '使用後の自身への能力付与')}
   ${effectEditor('selfEffects', effectsList, '使用後の自身への特殊効果')}
   ${namedField('付与の持続ターン', 'buffTurns', s.buffTurns)}
  </details>
  <details class="accordion"><summary>説明・備考</summary>${namedField('説明・備考', 'note', s.note, 'textarea')}${s.original || s.originalSource ? `<div class="source-quote" style="margin-top:12px">\
参照元：${esc(s.original || s.originalSource)}</div>` : ''}</details>
 </div><div class="modal-footer">${config.skills.some(v => v.id === s.id) && isCustomSkill(s) ? btn('このスキルを削除', 'delete-skill', 'danger', 'style="margin-right:auto"') : ''}${btn('キャンセル', 'close-modal')}${btn('保存のみ', 'save-skill-only')}${btn('保存してセット', 'save-skill', 'primary')}</div>`;
}
function syncDraft() {
    if (!modalDraft)
        return;
    $('#modal').querySelectorAll('[data-draft]').forEach(el => modalDraft[el.dataset.draft] = el.type === 'number' ? Number(el.value) : el.value);
    for (const group of ['effects', 'grantedEffects', 'selfEffects']) {
        for (const key of Object.keys(modalDraft[group] || {})) {
            if (FLAG_EFFECTS.has(key)) modalDraft[group][key] = 1;
        }
    }
    $('#modal').querySelectorAll('[data-effect-value]').forEach(el => {
        const [key, k] = el.dataset.effectValue.split(':');
        modalDraft[key][k] = Number(el.value);
    });
    const b = $('[data-draft-bs]');
    if (b)
        modalDraft.bs = [...b.selectedOptions].map(o => o.value);
}
function download(name, data, type = 'application/json') {
    const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ensureValid() {
    errors = validateConfig(config);
    if (errors.length) {
        render();
        toast('入力内容を確認してください。');
        return false;
    }
    return true;
}
async function simulate(full) {
    if (!ensureValid())
        return;
    busy = true;
    render();
    await new Promise(r => setTimeout(r, 20));
    try {
        if (!sim || sim.done || JSON.stringify(config) !== JSON.stringify(sim.config))
            sim = new Battle(config);
        if (full)
            sim.run();
        else
            sim.stepTurn();
        frame = sim.frames.length - 1;
        selectedLogId = sim.logs.at(-1)?.id ?? -1;
        logScrollTop = null;
    }
    catch (e) {
        errors = [e.message];
    }
    busy = false;
    render();
}
function startBatch() {
    if (!ensureValid())
        return;
    const n = Number($('#batch-count')?.value || batchCount);
    batchCount = n;
    batch = null;
    worker = new Worker('./worker.js?v=1.17.14', { type: 'module' });
    worker.onmessage = e => {
        if (e.data.error) {
            errors = [e.data.error];
            worker?.terminate();
            worker = null;
            render();
            return;
        }
        if (e.data.progress) {
            const el = $('#batch-progress');
            if (el)
                el.textContent = `${e.data.progress} / ${n} 回`;
            return;
        }
        batch = e.data;
        worker?.terminate();
        worker = null;
        render();
    };
    worker.onerror = e => {
        errors = ['一括計算に失敗しました：' + e.message];
        worker?.terminate();
        worker = null;
        render();
    };
    worker.postMessage({ config, n });
    render();
}
function shareStatus(message, error = false) {
    const node = $('#share-import-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', error);
}
function showSharePreview(actions) {
    shareImportActions = extractSharedArenaActions(actions);
    const node = $('#share-import-preview');
    if (!node) return;
    const titles = shareImportActions.map((r,i) => `${i + 1}. ${ACTIONS[({
       NormalAttack:'attack',SpecificSkill:'skill',AttackSkill:'effectiveAttack',
       HPHealSkill:'healHP',APHealSkill:'healAP',BSCureSkill:'healBS',
       ConcentrationOffense:'focusAttack',ConcentrationDefense:'focusDefense',
       Block:'block',Cover:'cover',MoveOnly:'move',AutoMove:'move',Wait:'wait',Refocus:'carry'
    })[r.maneuver.maneuver]] || r.maneuver.maneuver}${r.active ? '' : '（無効）'}`);
    node.hidden = false;
    node.innerHTML = `<p><strong>${shareImportActions.length}件のAIルールを取得しました。</strong> 保存前に取り込み方法を選んでください。</p>
    <div class="share-rule-preview">${titles.map(t=>`<div>${esc(t)}</div>`).join('')}</div>
    <label class="share-merge-label">取り込み方法
      <select id="share-import-mode"><option value="replace">現在のAIを置き換える</option><option value="append">現在のAIの末尾に追加する（最大20件）</option></select>
    </label>${btn('この内容を取り込む', 'apply-share-code', 'primary')}`;
}
function showShareDialog(unit) {
    shareImportTargetId = unit.id;
    shareImportActions = null;
    const dialog = $('#arena-share-dialog');
    const preview = $('#share-import-preview');
    if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    const code = $('#share-import-code');
    if (code) code.value = '';
    pendingShareBridge = null;
    const bridgePanel = $('#share-official-bridge');
    if (bridgePanel) bridgePanel.hidden = true;
    $('#share-import-unit').textContent = unit.name;
    shareStatus('共有コードを入力して検索してください。');
    dialog.showModal();
    code?.focus();
}
async function searchShareCode() {
    if (shareImportBusy) return;
    const code = $('#share-import-code')?.value;
    try {
        validateArenaShareCode(code);
        shareImportBusy = true;
        const button = $('#share-import-search');
        if (button) button.disabled = true;
        shareStatus('公式アリーナへ問い合わせています…');
        // Never send local character data or saved rules to the official server.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try { showSharePreview(await fetchArenaShareCode(code, {signal:controller.signal}));
              shareStatus('共有コードを取得しました。'); }
        finally { clearTimeout(timeout); }
    } catch (error) {
        shareImportActions = null;
        const preview = $('#share-import-preview');
        if (preview) preview.hidden = true;
        shareStatus(error.message, true);
        const bridgePanel = $('#share-official-bridge');
        if (bridgePanel) bridgePanel.hidden = false;
    } finally {
        shareImportBusy = false;
        const button = $('#share-import-search');
        if (button) button.disabled = false;
    }
}
function openOfficialArenaTab() {
    try {
        const code = validateArenaShareCode($('#share-import-code')?.value);
        const nonce = newBridgeNonce();
        const url = officialTabUrl(code, nonce, location.origin);
        // Open synchronously in response to the user click to avoid popup blockers.
        const popup = window.open(url, '_blank');
        if (!popup) throw Error('公式タブが開けません。ブラウザのポップアップブロックを解除してください。');
        pendingShareBridge = {popup, nonce, code};
        shareStatus('公式タブを開きました。連携拡張機能が入っていれば公式タブに「Battle LabへAIを送る」ボタンが表示されます。拡張機能がない場合は登録したブックマークをクリックしてください。');
        $('#share-official-bridge').hidden = false;
    } catch (error) { shareStatus(error.message, true); }
}
function onOfficialArenaBridgeMessage(event) {
    const pending = pendingShareBridge;
    if (!pending || !isOfficialBridgeEvent(event, pending)) return;
    if (!$('#arena-share-dialog')?.open) return;
    if (event.data.error) {
        shareStatus(`公式タブからの応答：${String(event.data.error).slice(0,240)}`, true);
        return;
    }
    try {
        showSharePreview(event.data.payload);
        shareStatus('公式のログイン済みタブから共有AIを取得しました。');
        pendingShareBridge = null;
    } catch (error) { shareStatus(error.message, true); }
}
window.addEventListener('message', onOfficialArenaBridgeMessage);

function applyShareResponse() {
    if (!shareImportActions || !shareImportTargetId) return;
    try {
        const target = config.units.find(u => u.id === shareImportTargetId);
        if (!target) throw Error('読み込み先が存在しません。');
        const mode = $('#share-import-mode')?.value || 'replace';
        const result = convertArenaSharedActions(shareImportActions, config, target.id, {mode});
        const summary = `「${target.name}」のAIに${result.ruleCount}件を${mode === 'replace' ? '置き換え' : '追加'}ます。\n未解決の指定スキル：${result.unresolvedSkills}件\n無効のルール：${result.disabledCount}件\n能力値・装備スキル・他キャラの設定は変更しません。\n\n続行しますか？`;
        if (!confirm(summary)) return;
        config = result.config;
        arenaImportReport = {unitId: target.id, ruleCount: result.ruleCount, warnings: result.warnings};
        selected = target.id; page = 'rules';
        sim = null; batch = null; frame = -1; selectedLogId = -1; errors = [];
        save(); render();
        $('#arena-share-dialog').close();
        toast(`${result.ruleCount}件の共有AIを取り込みました。${result.disabledCount ? `確認が必要な${result.disabledCount}件は無効です。` : ''}`);
    } catch(error) { shareStatus(error.message, true); }
}
async function onAction(act) {
    const [a, arg, arg2] = act.split(':');
    const u = current();
    if (a === 'toggle-mobile-rule') {
        const i = Number(arg), card = document.querySelector(`[data-mobile-rule="${i}"]`);
        if (!card) return;
        const opening = !mobileExpandedRules.has(i);
        if (opening) mobileExpandedRules.add(i); else mobileExpandedRules.delete(i);
        card.classList.toggle('mobile-collapsed', !opening);
        const toggle = card.querySelector('.mobile-rule-toggle');
        if (toggle) {
            toggle.textContent = opening ? '閉じる' : '開く';
            toggle.setAttribute('aria-expanded', String(opening));
            toggle.setAttribute('aria-label', `ルール${i + 1}の編集欄を${opening ? '閉じる' : '開く'}`);
        }
        return;
    }
    if (a === 'map-zoom-in' || a === 'map-zoom-out') {
        const i = MAP_ZOOM_STEPS.indexOf(mapZoom);
        mapZoom = MAP_ZOOM_STEPS[Math.max(0, Math.min(MAP_ZOOM_STEPS.length - 1, i + (a === 'map-zoom-in' ? 1 : -1)))];
        if (mapZoom === 1)
            mapPan = { x: 0, y: 0 };
        repaintMaps();
        return;
    }
    if (a === 'map-center') {
        mapPan = { x: 0, y: 0 };
        repaintMaps();
        return;
    }
    if (a === 'map-expand') {
        openExpandedMap();
        return;
    }
    if (a === 'map-dialog-close') {
        $('#map-dialog')?.close();
        return;
    }
    if (a === 'select-log') {
        selectLog(Number(arg));
        return;
    }
    if (a === 'character-import') {
        openCharacterImport();
        return;
    }
    if (a === 'export-unit-tactics') {
        try {
            const filename = (u.name || 'unit').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60) || 'unit';
            download(`${filename}-スキルAI.json`, exportUnitTactics(config, u.id));
            toast(`${u.name}のスキル・AI設定を書き出しました。`);
        }
        catch (err) {
            toast('書き出せません：' + err.message);
        }
        return;
    }
    if (a === 'import-unit-tactics') {
        unitTacticsImportTarget = u.id;
        $('#unit-tactics-import').click();
        return;
    }
    if (a === 'import-share-code') {
        showShareDialog(u);
        return;
    }
    if (a === 'search-share-code') {
        await searchShareCode();
        return;
    }
    if (a === 'open-official-arena-tab') {
        openOfficialArenaTab();
        return;
    }
    if (a === 'apply-share-code') {
        applyShareResponse();
        return;
    }
    if (a === 'close-share-code') {
        pendingShareBridge = null;
        $('#arena-share-dialog').close();
        return;
    }
    if (a === 'import-arena-tactics') {
        arenaImportTarget = u.id;
        $('#arena-html-import').click();
        return;
    }
    if (a === 'open-bug-report') {
        document.querySelector('.mobile-file-menu')?.removeAttribute('open');
        document.getElementById('bug-report-dialog')?.showModal();
        return;
    }
    if (a === 'page') {
        page = arg;
        errors = [];
        render();
        window.scrollTo(0, 0);
        return;
    }
    if (a === 'unit') {
        selected = arg;
        render();
        return;
    }
    if (a === 'close-modal') {
        $('#modal').close();
        return;
    }
    if (a === 'skill-detail') {
        openSkill(arg);
        return;
    }
    if (a === 'new-skill') {
        openSkill();
        return;
    }
    if (a === 'copy-skill') {
        openSkill(arg, true);
        return;
    }
    if (a === 'add-effect') {
        syncDraft();
        const labels = ['modifiers', 'selfModifiers'].includes(arg) ? GRANT_STAT_LABELS : arg === 'castMods' ? { critical: 'CT', fumble: 'FB' } : modalMode === 'unit' ? EFFECTS : arg === 'grantedEffects' && accelCategory(modalDraft.kind) === 'buff' ? ACCEL_BUFF_EFFECTS : accelEffects(modalDraft.kind);
        modalDraft[arg] ??= {};
        const k = Object.keys(labels).find(k => !(k in modalDraft[arg]));
        if (k)
            modalDraft[arg][k] = 1;
        renderModal();
        return;
    }
    if (a === 'remove-effect') {
        syncDraft();
        delete modalDraft[arg][arg2];
        renderModal();
        return;
    }
    if (a === 'unit-effects') {
        modalMode = 'unit';
        modalDraft = { effects: clone(u.effects || {}) };
        renderModal();
        $('#modal').showModal();
        return;
    }
    if (a === 'save-unit-effects') {
        syncDraft();
        u.effects = clone(modalDraft.effects);
        for (const key of Object.keys(u.effects)) if (FLAG_EFFECTS.has(key)) u.effects[key] = 1;
        $('#modal').close();
        save();
        render();
        return;
    }
    if (a === 'save-skill' || a === 'save-skill-only') {
        syncDraft();
        adaptAccelDraft(modalDraft);
        const s = modalDraft;
        if (!s.name?.trim() || !Number.isFinite(s.ap) || s.ap < 0 || !Number.isFinite(s.cost) || (s.kind !== 'passive' && (s.cost < 0 || s.cost + (s.effects?.chargeTime || 0) < 1))) {
            toast('スキル名、AP（0以上）、行動値＋溜（1以上）を確認してください。');
            return;
        }
        delete s.requiresReview;
        const fresh = !config.skills.some(v => v.id === s.id);
        try {
            saveSkillDraft(config, s, u.id, a === 'save-skill');
        }
        catch (err) {
            toast(err.message);
            return;
        }
        $('#modal').close();
        if (fresh) {
            skillFilter = 'custom';
            kindFilter = 'all';
            skillSearch = '';
            skillPage = 0;
        }
        save();
        render();
        toast(a === 'save-skill' ? 'アクセルカレイドを保存してセットしました。' : 'スキルを保存しました。');
        return;
    }
    if (a === 'delete-skill') {
        const id = modalDraft?.id;
        const skill = config.skills.find(s => s.id === id);
        if (!skill || isProtectedSkill(skill)) {
            toast('既存スキルは削除できません。');
            return;
        }
        const count = config.units.flatMap(v => v.rules).filter(r => r.action === 'skill' && r.skillId === id).length;
        const notice = count ? `「${skill.name}」を削除しますか？\nこのスキルを使うキャラAI設定 ${count}件は通常攻撃に変更されます。` : `「${skill.name}」を削除しますか？`;
        if (!confirm(notice))
            return;
        const result = deleteCustomSkill(config, id);
        if (!result.ok) {
            toast(result.reason);
            return;
        }
        $('#modal').close();
        save();
        render();
        toast('アクセルカレイドを削除しました。');
        return;
    }
    if (a === 'equip' || a === 'modal-equip') {
        if (u.skills.includes(arg)) {
            if (u.rules.some(r => r.enabled && r.action === 'skill' && r.skillId === arg)) {
                toast('キャラAI設定で指定されています。先に行動を変更してください。');
                return;
            }
            u.skills = u.skills.filter(id => id !== arg);
        }
        else {
            const candidate = config.skills.find(skill => skill.id === arg);
            if (!candidate || candidate.kind === 'passive') {
                toast('このスキルはセットできません。');
                return;
            }
            u.skills.push(arg);
        }
        if (a === 'modal-equip')
            $('#modal').close();
        save();
        render();
        return;
    }
    if (a === 'skill-next' || a === 'skill-prev') {
        // 検索欄を含む画面全体は再描画しない（スクロール・IME入力を維持）。
        skillPage += a === 'skill-next' ? 1 : -1;
        refreshSkillResults();
        const direction = a === 'skill-next' ? 'skill-next' : 'skill-prev';
        document.querySelector(`[data-act="${direction}"]`)?.focus({ preventScroll: true });
        return;
    }
    if (a === 'add-unit') {
        if (config.units.length >= 16) {
            toast('ユニットは最大16人です。');
            return;
        }
        const v = freshUnit({
            name: `${arg === 'A' ? '味方' : '敵'}ユニット ${config.units.filter(x => x.team === arg).length + 1}`,
            team: arg,
            x: arg === 'A' ? -10 : 10,
            y: 0
        });
        config.units.push(v);
        arrangeInitialPositions(config.units);
        selected = v.id;
    }
    else if (a === 'clone-unit') {
        if (config.units.length >= 16) {
            toast('ユニットは最大16人です。');
            return;
        }
        const v = clone(u);
        v.id = uid('u');
        for (const rule of v.rules) {
            if (rule.target === 'id' && rule.targetUnitId === u.id) rule.targetUnitId = v.id;
            if (rule.moveSubject === 'id' && rule.moveUnitId === u.id) rule.moveUnitId = v.id;
            for (const c of [...(rule.conditions || []), ...(rule.moveConditions || [])])
                if (c.type === 'who' && c.subject === 'id' && c.characterId === u.id) c.characterId = v.id;
        }
        v.name += '（コピー）';
        config.units.push(v);
        arrangeInitialPositions(config.units);
        selected = v.id;
    }
    else if (a === 'delete-unit') {
        if (config.units.filter(v => v.team === u.team).length <= 1) {
            toast('各チームに1人以上必要です。');
            return;
        }
        config.units = config.units.filter(v => v.id !== u.id);
        for (const v of config.units)
            for (const r of v.rules)
                if (r.moveSubject === 'id' && r.moveUnitId === u.id)
                    r.moveUnitId = v.id;
                if (r.target === 'id' && r.targetUnitId === u.id)
                    r.targetUnitId = v.id;
                for (const c of [...r.conditions, ...(r.moveConditions || [])])
                    if (c.type === 'who' && c.subject === 'id' && c.characterId === u.id)
                        c.characterId = v.id;
        arrangeInitialPositions(config.units);
        selected = config.units[0].id;
    }
    else if (a === 'add-rule') {
        if (u.rules.length >= ARENA_MAX_RULES) { toast('公式仕様では最大20件です。'); return; }
        u.rules.push(freshRule());
    }
    else if (a === 'delete-rule')
        u.rules.splice(Number(arg), 1);
    else if (a === 'clone-rule') {
        if (u.rules.length >= ARENA_MAX_RULES) { toast('公式仕様では最大20件です。'); return; }
        const r = clone(u.rules[arg]);
        r.id = uid('r');
        u.rules.splice(Number(arg) + 1, 0, r);
    }
    else if (a === 'up-rule' || a === 'down-rule') {
        const i = Number(arg), j = i + (a === 'up-rule' ? -1 : 1);
        [u.rules[i], u.rules[j]] = [u.rules[j], u.rules[i]];
    }
    else if (a === 'add-condition') {
        if (u.rules[arg].conditions.length >= ARENA_MAX_CONDITIONS) { toast('公式仕様では1戦術につき最大5条件です。'); return; }
        u.rules[arg].conditions.push(freshCondition());
    }
    else if (a === 'add-target-condition') {
        const r = u.rules[arg];
        ensureTargetCriteria(r).push(freshTargetCriterion());
    }
    else if (a === 'add-move-condition') {
        const r = u.rules[arg];
        if (!Array.isArray(r.moveConditions))
            r.moveConditions = [];
        if (r.moveConditions.length >= ARENA_MAX_CONDITIONS) { toast('追加条件は最大5件です。'); return; }
        r.moveConditions.push(freshCondition());
    }
    else if (a === 'remove-condition')
        u.rules[arg].conditions.splice(Number(arg2), 1);
    else if (a === 'remove-target-condition')
        ensureTargetCriteria(u.rules[arg]).splice(Number(arg2), 1);
    else if (a === 'remove-move-condition')
        u.rules[arg].moveConditions.splice(Number(arg2), 1);
    else if (a === 'run' || a === 'step') {
        await simulate(a === 'run');
        return;
    }
    else if (a === 'reset-sim') {
        sim = null;
        frame = -1;
        selectedLogId = -1;
        logScrollTop = null;
        batch = null;
    }
    else if (a === 'batch') {
        startBatch();
        return;
    }
    else if (a === 'cancel-batch') {
        worker?.terminate();
        worker = null;
        toast('一括計算を中止しました。');
        render();
        return;
    }
    else if (a === 'export-character') {
        try {
            const filename = (u.name || 'character').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60) || 'character';
            download(`${filename}-キャラクター.json`, exportUnitCharacter(config, u.id));
            toast(`${u.name}のキャラクター設定を書き出しました。`);
        } catch (err) { toast('書き出せません：' + err.message); }
        return;
    }
    else if (a === 'import-character') {
        characterJsonImportTarget = u.id;
        $('#character-json-import').click();
        return;
    }
    else if (a === 'export-result') {
        download('arcadia-battle-result.json', { ...sim.result(), config: sim.config });
        return;
    }
    else if (a === 'export-log') {
        download('arcadia-battle-log.txt', `ロスアカ Battle Lab / seed: ${sim.seed}\n\n` + sim.logs.map(l => `[T${String(l.turn).padStart(2, '0')} / ${['speed', 'sudden', 'suddenDamage'].includes(l.type) ? '開始時' : `残行動値 ${Math.floor(l.gauge)}`}] ${l.message}${l.tags?.length ? '\n  【効果】' + l.tags.map(t => t.label).join(' / ') : ''}${l.detail ? '\n  ' + l.detail : ''}`).join('\n'), 'text/plain');
        return;
    }
    else if (a === 'reset-config') {
        if (!confirm('現在の設定を初期編成に戻します。必要なら先に設定を書き出してください。'))
            return;
        config = makeSample();
        selected = config.units[0].id;
        sim = null;
        batch = null;
        page = 'setup';
    }
    else
        return;
    save();
    render();
}
document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-log-id]')) {
        e.preventDefault();
        selectLog(Number(e.target.dataset.logId));
    }
});
document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled && b.dataset.act === 'toggle-theme') {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('battle-lab-theme', next); } catch { /* private mode: current session only */ }
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#151c24' : '#f1f3f4');
        render();
        return;
    }
    if (b && !b.disabled)
        onAction(b.dataset.act);
});
document.addEventListener('change', e => {
    const el = e.target, u = current();
    if (el.matches('[data-map-relations]')) {
        mapRelations = el.checked;
        repaintMaps();
        return;
    }
    if (el.matches('[data-map-movement]')) {
        mapMoveCircle = el.checked;
        repaintMaps();
        return;
    }
    if (el.matches('[data-map-focus]')) {
        mapFocus = el.value;
        repaintMaps();
        return;
    }
    if (el.matches('[data-element-key]')) {
        const key = el.value || null;
        if (key !== null && !ELEMENT_KEYS.includes(key)) return;
        u.element = key ? { key, value: u.element?.value || 0 } : emptyElement();
        save();
        const valueField = document.querySelector('[data-element-value]');
        if (valueField) {
            valueField.disabled = !key;
            valueField.value = u.element.value;
        }
        const label = document.querySelector('[data-element-level]');
        if (label) label.textContent = `Lv${elementLevel(u.element.value)}`;
        return;
    }
    if (el.matches('[data-element-value]')) {
        const value = el.value.trim() === '' ? NaN : Number(el.value);
        if (!Number.isSafeInteger(value) || value < 0 || value > 1e6) {
            toast('属性値は0～1000000の整数で指定してください。');
            el.value = u.element?.value ?? 0;
            return;
        }
        if (!u.element?.key) return;
        u.element.value = value;
        save();
        const label = document.querySelector('[data-element-level]');
        if (label) label.textContent = `Lv${elementLevel(value)}`;
        return;
    }
    if (el.matches('[data-unit]')) {
        const k = el.dataset.unit;
        u[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        if (['x', 'y'].includes(k))
            u[k] = clamp(u[k], -75, 75);
        if (k === 'team')
            arrangeInitialPositions(config.units);
        if (['startHp', 'startAp'].includes(k))
            u[k] = clamp(u[k], 0, 100);
        save();
        render();
        return;
    }
    if (el.matches('[data-unit-bs]')) {
        u.initialBS = [...el.selectedOptions].map(o => o.value);
        save();
        return;
    }
    if (el.matches('[data-unit-immunity]')) {
        u.immunities = [...el.selectedOptions].map(o => o.value);
        save();
        return;
    }
    if (el.matches('[data-select-unit]')) {
        selected = el.value;
        render();
        return;
    }
    if (el.matches('[data-settings]')) {
        config.settings[el.dataset.settings] = el.type === 'number' ? Number(el.value) : el.value;
        normalizeSettings(config);
        save();
        if (el.dataset.settings === 'seedMode')
            render();
        return;
    }
    if (el.matches('[data-rule]')) {
        const [i, k] = el.dataset.rule.split(':');
        const r = u.rules[i];
        // Preserve empty positioning inputs as null; Number('') would turn them into 0m.
        r[k] = ['minDist', 'maxDist'].includes(k) && el.value === '' ? null :
            el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) :
                ['autoMove'].includes(k) ? el.value === 'true' : el.value;
        if (['minDist', 'maxDist'].includes(k) && r[k] !== null)
            r[k] = Math.max(0, Math.min(999, Math.trunc(r[k])));
        if (k === 'action') {
            if (['healHP', 'healAP', 'healBS', 'cover'].includes(r.action))
                r.target = 'allies';
            if (['focusAttack', 'focusDefense', 'carry', 'wait'].includes(r.action)) {
                r.target = 'self';
                // A focus action is self-only; preserve explicit independent positioning.
                if (['focusAttack', 'focusDefense'].includes(r.action) && r.splitMovement && r.moveTargetMode === 'individual') {
                    r.autoMove = true;
                    r.movePriority = 'movement';
                } else {
                    r.autoMove = false;
                }
            }
            if (['attack', 'effectiveAttack', 'block'].includes(r.action))
                r.target = 'enemies';
        }
        if (k === 'splitMovement' && ['focusAttack', 'focusDefense'].includes(r.action)) {
            // Make an enabled focus split immediately usable; never move for legacy
            // focus rules unless the user explicitly checks the split setting.
            r.target = 'self';
            if (r.splitMovement) {
                r.moveTargetMode = 'individual';
                if (r.moveSubject === 'previous') r.moveSubject = 'enemies';
                r.movePriority = 'movement';
                r.autoMove = true;
            } else {
                r.autoMove = false;
            }
        }
        if (k === 'target' && r.target === 'id' && !r.targetUnitId)
            r.targetUnitId = u.id;
        if (k === 'moveTargetMode' && r.moveTargetMode === 'individual' && r.moveSubject === 'id' && !r.moveUnitId)
            r.moveUnitId = u.id;
        if (k === 'moveSubject' && r.moveSubject === 'id' && !r.moveUnitId)
            r.moveUnitId = u.id;
        save();
        render();
        return;
    }
    // Official Arena subject picker combines the historical type and subject fields.
    function updateOfficialCondition(c, key, element) {
        if (key === 'selector') {
            const selected = element.value;
            if (selected.startsWith('who:')) {
                c.type = 'who'; c.subject = selected.slice(4);
                if (c.subject === 'id' && !c.characterId) c.characterId = u.id;
                if (!ARENA_CONDITION_SPECS[c.metric]) resetOfficialMetric(c, 'alive');
            } else {
                c.type = selected;
            }
            return;
        }
        if (key === 'metric') { resetOfficialMetric(c, element.value); return; }
        if (key === 'not') { c.not = element.value === 'true'; return; }
        if (key === 'multiple') { c.multiple = Math.min(10, Math.max(1, Number(element.value) || 1)); return; }
        if (key === 'characterId') { c.characterId = element.value; return; }
        if (key === 'min' || key === 'max') {
            const spec = ARENA_CONDITION_SPECS[c.metric];
            const low = spec?.range_min ?? -9999, high = spec?.range_max ?? 99999;
            c[key] = Math.max(low, Math.min(high, Math.trunc(Number(element.value) || 0)));
            return;
        }
        if (key === 'chance') { c.chance = Math.max(0, Math.min(100, Math.trunc(Number(element.value) || 0))); return; }
        if (key === 'offset') { c.offset = Math.max(0, Math.trunc(Number(element.value) || 0)); return; }
        c[key] = element.type === 'number' ? Number(element.value) : element.value;
    }
    if (el.matches('[data-condition]')) {
        const [ri, ci, k] = el.dataset.condition.split(':');
        const c = u.rules[ri].conditions[ci];
        if (k === 'bs') {
            const chooser = el.closest('.bs-condition-chooser');
            c.bs = [...chooser.querySelectorAll('input[type=checkbox]:checked')].map(item => item.value);
            chooser.querySelector('summary').textContent = selectedBsTitle(c.bs);
        }
        else updateOfficialCondition(c, k, el);
        save();
        if (k !== 'bs') render();
        return;
    }
    if (el.matches('[data-target-condition]')) {
        const [ri, ci, k] = el.dataset.targetCondition.split(':');
        const rows = ensureTargetCriteria(u.rules[ri]);
        const c = rows[ci];
        if (k === 'choice') {
            const [type, key] = el.value.split(':');
            if (type === 'sort' && TARGET_SORTS[key])
                rows[ci] = { type: 'sort', sort: key };
            else if (type === 'filter' && ARENA_CONDITION_SPECS[key]) {
                rows[ci] = freshTargetCriterion();
                resetOfficialMetric(rows[ci], key);
            }
        }
        else if (k === 'bs') {
            const chooser = el.closest('.bs-condition-chooser');
            c.bs = [...chooser.querySelectorAll('input[type=checkbox]:checked')].map(item => item.value);
            chooser.querySelector('summary').textContent = selectedBsTitle(c.bs);
        }
        else updateOfficialCondition(c, k, el);
        save();
        if (k !== 'bs') render();
        return;
    }
    if (el.matches('[data-move-condition]')) {
        const [ri, ci, k] = el.dataset.moveCondition.split(':');
        const c = u.rules[ri].moveConditions[ci];
        if (k === 'bs') {
            const chooser = el.closest('.bs-condition-chooser');
            c.bs = [...chooser.querySelectorAll('input[type=checkbox]:checked')].map(item => item.value);
            chooser.querySelector('summary').textContent = selectedBsTitle(c.bs);
        }
        else updateOfficialCondition(c, k, el);
        save();
        if (k !== 'bs') render();
        return;
    }
    if (el.id === 'batch-count') {
        batchCount = Number(el.value);
        return;
    }
    if (el.id === 'kind-filter') {
        kindFilter = el.value;
        skillPage = 0;
        render();
        return;
    }
    if (el.id === 'skill-filter') {
        skillFilter = el.value;
        skillPage = 0;
        render();
        return;
    }
    if (el.id === 'log-type') {
        logType = el.value;
        refreshLogList();
        return;
    }
    if (el.id === 'log-turn') {
        logTurn = el.value;
        refreshLogList();
        return;
    }
    if (el.matches('[data-draft-category]')) {
        syncDraft();
        const next = el.value;
        if (next === 'heal')
            modalDraft.kind = 'hp';
        else
            modalDraft.kind = next;
        adaptAccelDraft(modalDraft);
        renderModal();
        return;
    }
    if (el.matches('[data-heal-mode]')) {
        syncDraft();
        modalDraft.kind = el.value;
        if (modalDraft.kind === 'cleanse' && !Number(modalDraft.effects?.bsHeal))
            modalDraft.effects.bsHeal = 100;
        else if (modalDraft.kind !== 'cleanse')
            delete modalDraft.effects.bsHeal;
        renderModal();
        return;
    }
    if (el.matches('[data-effect-key]')) {
        syncDraft();
        const [key, old] = el.dataset.effectKey.split(':');
        const val = modalDraft[key][old];
        delete modalDraft[key][old];
        modalDraft[key][el.value] = FLAG_EFFECTS.has(el.value) ? 1 : (FLAG_EFFECTS.has(old) ? 1 : val);
        renderModal();
        return;
    }
});
document.addEventListener('pointerdown', e => {
    const svg = e.target.closest?.('svg.battle-map');
    if (!svg || mapZoom <= 1 || e.button !== 0)
        return;
    mapDrag = {
        id: e.pointerId,
        svg,
        startX: e.clientX,
        startY: e.clientY,
        x: mapPan.x,
        y: mapPan.y
    };
    svg.setPointerCapture?.(e.pointerId);
});
document.addEventListener('pointermove', e => {
    if (!mapDrag || e.pointerId !== mapDrag.id)
        return;
    const { svg, startX, startY, x, y } = mapDrag;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height)
        return;
    const scale = Number(svg.dataset.baseScale), baseW = Number(svg.dataset.baseWidth), baseH = Number(svg.dataset.baseHeight);
    mapPan = { x: x - (e.clientX - startX) / (scale * mapZoom * rect.width / baseW), y: y + (e.clientY - startY) / (scale * mapZoom * rect.height / baseH) };
    const v = mapViewport(baseW, baseH, scale, mapZoom, mapPan, config.settings.mapSize || 150);
    mapPan = v.pan;
    // SVGのviewBoxだけを差し替え、ドラッグ中のpointer captureは維持する。
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
});
document.addEventListener('pointerup', e => {
    if (mapDrag && e.pointerId === mapDrag.id) {
        mapDrag = null;
        repaintMaps();
    }
});
document.addEventListener('pointercancel', e => {
    if (mapDrag && e.pointerId === mapDrag.id) {
        mapDrag = null;
        repaintMaps();
    }
});
// 日本語IME変換中に検索欄を破棄すると、スマホの変換・連続入力が途切れる。
// 検索結果だけを更新し、入力欄・カーソル・変換セッションを保持する。
let searchTimer;
let skillSearchComposing = false;
function refreshSkillResults() {
    if (page !== 'skills') return;
    const results = $('#skill-result-area');
    if (!results) return;
    const preview = document.createElement('template');
    preview.innerHTML = skillsPage();
    const updated = preview.content.querySelector('#skill-result-area');
    if (updated) results.innerHTML = updated.innerHTML;
}
function scheduleSkillSearch(value) {
    skillSearch = value;
    skillPage = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshSkillResults, 150);
}
document.addEventListener('compositionstart', e => {
    if (e.target.id !== 'skill-search') return;
    skillSearchComposing = true;
    clearTimeout(searchTimer);
});
document.addEventListener('compositionend', e => {
    if (e.target.id !== 'skill-search') return;
    skillSearchComposing = false;
    scheduleSkillSearch(e.target.value);
});
document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'frame-range') {
        frame = Number(el.value);
        selectedLogId = -1;
        paintReplay();
        return;
    }
    if (el.id === 'skill-search') {
        if (!skillSearchComposing && !e.isComposing)
            scheduleSkillSearch(el.value);
        return;
    }
    if (el.id === 'log-search') {
        logSearch = el.value;
        refreshLogList();
    }
});
$('#character-json-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    const targetId = characterJsonImportTarget;
    characterJsonImportTarget = null;
    if (!f) return;
    try {
        if (f.size > 3000000) throw Error('キャラJSONは3MB以下にしてください。');
        const payload = JSON.parse(await f.text());
        const target = config.units.find(unit => unit.id === targetId);
        if (!target) throw Error('読み込み先のキャラクターが見つかりません。');
        const result = importUnitCharacter(config, targetId, payload);
        if (!confirm(`選択中の「${target.name}」を「${result.name}」の設定で置き換えます。\n能力値・固有効果・開始時BS・装備スキル・AIを読み込みます。\nチーム・初期座標と他のキャラクターは変更しません。\n続行しますか？`)) return;
        config = normalizeSettings(cleanWebConfiguration(result.config));
        normalizeMoveModes(config);
        selected = targetId;
        sim = null;
        batch = null;
        frame = -1;
        selectedLogId = -1;
        errors = [];
        save();
        render();
        toast(`${result.name}のキャラクター設定を読み込みました。`);
    } catch (err) {
        toast('キャラJSONを読み込めません：' + err.message);
    } finally {
        e.target.value = '';
    }
});
$('#unit-tactics-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f)
        return;
    const targetId = unitTacticsImportTarget;
    unitTacticsImportTarget = null;
    try {
        if (f.size > 3000000)
            throw Error('キャラ別設定ファイルは3MB以下にしてください。');
        const payload = JSON.parse(await f.text());
        const target = config.units.find(u => u.id === targetId);
        if (!target)
            throw Error('読込先のキャラクターが見つかりません。');
        const outcome = importUnitTactics(config, targetId, payload);
        cleanWebConfiguration(outcome.config);
        normalizeMoveModes(outcome.config);
        if (!confirm(`「${target.name}」の現在の装備スキルとキャラAIルールを置き換えます。\n元ファイル：${payload.sourceUnit.name || '名前なし'}\nスキル ${outcome.skillCount} 件 / AIルール ${outcome.ruleCount} 件\n\n能力値やチーム、他キャラの設定は変更されません。続行しますか？`))
            return;
        config = outcome.config;
        sim = null;
        batch = null;
        frame = -1;
        selectedLogId = -1;
        errors = [];
        save();
        render();
        toast(`${target.name}のスキル・AIを読み込みました。${outcome.addedCustomSkills ? ' 自作スキル ' + outcome.addedCustomSkills + '件も登録。' : ''}${outcome.warnings.length ? ' ※移動基準の一部を調整しました。' : ''}`);
    }
    catch (err) {
        toast('読み込めません：' + err.message);
    }
    finally {
        e.target.value = '';
    }
});
// Installable bookmarklet: drag its link into the bookmarks bar.
// An extension in the ZIP performs the same request automatically on the official tab.
const bookmarklet = $('#share-bookmarklet');
if (bookmarklet) bookmarklet.setAttribute('href', officialBookmarkletHref());
bookmarklet?.addEventListener('click', event => {
    event.preventDefault();
    shareStatus('このリンクをブックマークバーにドラッグして登録し、Battle Labから開いた公式タブ上でクリックしてください。');
});
$('#arena-html-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0], unitId = arenaImportTarget;
    arenaImportTarget = null;
    if (!f)
        return;
    try {
        if (f.size > 3000000)
            throw Error('アリーナHTMLは3MB以下にしてください。');
        const parsed = parseArenaHtml(await f.text());
        const destination = config.units.find(unit => unit.id === unitId);
        if (!destination)
            throw Error('読み込み先のキャラクターが見つかりません。');
        const outcome = importArenaTactics(config, unitId, parsed);
        const missing = [...new Set(outcome.unresolved.filter(x => x.reason === 'not-found').map(x => x.name))].filter(Boolean);
        const ambiguous = [...new Set(outcome.unresolved.filter(x => x.reason === 'ambiguous').map(x => x.name))].filter(Boolean);
        const drafts = [...new Set(outcome.unresolved.filter(x => x.reason === 'needs-configuration').map(x => x.name))].filter(Boolean);
        const details = [
            missing.length ? `見つからないスキル：${missing.join('、')}` : '',
            ambiguous.length ? `同名スキルが複数で特定できない：${ambiguous.join('、')}` : '',
            drafts.length ? `未設定のアクセルカレイド：${drafts.join('、')}（性能を編集するまで行動は無効）` : ''
        ].filter(Boolean).map(x => '\n' + x).join('');
        if (!confirm(`「${destination.name}」に公式アリーナの戦法を適用します。\n元データ：${outcome.source}\nAI ${outcome.ruleCount}行（「上記のどの条件も満たさない場合」以降は除外）\n未対応スキルの行 ${outcome.unresolved.length}行${details}\n\n現在のAIルールを置き換えます。該当スキルは装備に追加し、その他の装備、能力値、チームは保持します。続行しますか？`))
            return;
        config = outcome.config;
        arenaImportReport = { unitId, ruleCount: outcome.ruleCount, warnings: outcome.warnings };
        selected = unitId;
        page = 'rules';
        sim = null;
        batch = null;
        frame = -1;
        selectedLogId = -1;
        errors = [];
        save();
        render();
        toast(`アリーナ戦術 ${outcome.ruleCount}行を読み込みました。${outcome.unresolved.length ? ` 未対応スキル ${outcome.unresolved.length}行は無効です。` : ''}`);
    }
    catch (err) {
        toast('アリーナHTMLを読み込めません：' + err.message);
    }
    finally {
        e.target.value = '';
    }
});
save();
render();
