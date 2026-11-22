import { REACTION_DEFINITIONS, MAX_REACTION_LENGTH, buildBattleReactions, battleReactionByLog, battleReactionAt, normalizedReactionLines } from './battle-reactions.js?v=1.18.21&dialogueui=1&hard=1';
import { exportReactionJson, readReactionJson } from './reaction-json-io.js?v=1.18.21&dialoguejson=1';
import { confirmInApp } from './in-app-confirm.js?v=1.18.21&dialogueui=1';
import { PAGE_GUIDES } from './page-guide.js?v=1.18.21&dialoguejson=1&reactions=2&logfirst=1&labels=0&seraramap=1&guidecopy=1';
import { readUiState, writeUiState, readReplayState, writeReplayState } from './view-state.js?v=1.18.4';
import { conditionalPassiveDescription, conditionalPassiveState, passiveStatusPreview, conditionalPassivePreviewOptions, validConditionalPassives, CONDITIONAL_SUPPORTED_EFFECT_KEYS } from './conditional-passives.js?v=1.18.4&edit=1';
import { CONDITIONAL_PASSIVE_TEMPLATES, CONDITIONAL_KIND_OPTIONS, makePresetPassive, makeCustomPassive, applyPassiveEditor, isFixedConditionalPassive } from './passive-editor.js?v=1.18.4&edit=1';
import { deleteUnitSafely } from './unit-management.js?v=1.18.19';
import { normalizeMoveModes, STAT_LABELS, SUBJECTS, METRICS, ACTIONS, RANGES, SCOPES, SKILL_KINDS, EFFECTS, BOOL_EFFECTS, BS_NAMES, BS_GROUPS, freshCondition, freshTargetCondition, freshTargetCriterion, targetCriteriaForRule, ensureTargetCriteria, TARGET_SORTS, freshRule, freshSkill, freshUnit, sampleConfig, arrangeInitialPositions, allocateDefaultUnitName, uid, clone, validateConfig, ARENA_SUBJECT_CHOICES, ARENA_ACTION_CHOICES, ARENA_CONDITION_SPECS, ARENA_METRIC_ROWS, ARENA_SORT_ROWS, ARENA_SUBJECT_ROWS, ARENA_MAX_RULES, ARENA_MAX_CONDITIONS } from './model.js?v=1.18.21&dialogueui=1';
import { OFFICIAL_MOVE_ROWS } from './official-ai-schema.js?v=1.18';
import { isProtectedSkill, isReadOnlySkill, isCustomSkill, copyAsCustom, saveSkillDraft, deleteCustomSkill, migrateLegacyDemoSkills } from './custom-skills.js?v=1.18.19';
import { Battle, clamp } from './engine.js?v=1.18.21&dialogueui=1';
import { combatLogTypeLabel, bsStatusLabel } from './combat-log-format.js';
import { teamBattleStats } from './battle-summary.js';
import { renderCombatStatistics } from './battle-statistics-ui.js?v=1.18.19';
import { loadOfficialArenaViaWorker, parseOfficialArenaResult, officialArenaResultLocation, officialArenaStatistics, officialArenaDisplayGroups, officialArenaLogTypeLabel } from './official-arena-log.js?v=1.18.19';
import { exportUnitTactics, importUnitTactics } from './unit-tactics-io.js?v=1.18.21&dialogueui=1';
import { exportUnitCharacter, importUnitCharacter } from './unit-character-io.js?v=1.18.21&dialogueui=1';
import { CHARACTER_SLOT_COUNT, readCharacterSlots, saveCharacterSlot, clearCharacterSlot, loadCharacterSlot } from './character-slots.js?v=1.18.19';
import { parseArenaHtml, importArenaTactics } from './arena-html-import.js?v=1.18.19';
import { extractSharedArenaActions, convertArenaSharedActions, validateArenaShareCode } from './arena-share-import.js?v=1.18.19';
import { fetchArenaSharedAiViaWorker, issueArenaShareCodeViaWorker } from './arena-worker-import.js?v=1.18';
import { buildOfficialArenaActions } from './arena-share-export.js?v=1.18.19';
import { ARENA_SHARED_WORKER_URL } from './arena-worker-config.js?v=1.18';
import { normalizeSettings } from './run-settings.js';
import { deduplicateImportedSkills, displayedSkillName, displayedSkillText, isWikiSkill } from './skill-dedup.js?v=1.18.19';
import { MAP_ZOOM_STEPS, mapRelationPairs, mapViewport } from './map-relations.js';
import { replayActorId, groupReplayUnitsByTeam } from './replay-view.js';
import { createCharacterImporter } from './character-ui.js?v=1.18.21&dialogueui=1';
import { skillMatchesKind } from './skill-kind-filter.js';
import { cleanWebConfiguration } from './web-configuration.js';
import { ELEMENT_KEYS, emptyElement, elementLevel } from './element-bonus.js?v=1.18';
import { CHALLENGES, CHALLENGE_BOSS_ID, isSeraraChallengeId, activeChallenge, canEditChallengeUnit, challengePartyValid, startChallenge, endChallenge } from './challenge-content.js?v=1.18.19&hard=1';
import { SERARA_REACTION_LINES, seraraReactionAt, seraraReactionByLog } from './challenge-reactions.js?v=1.18.19&logfirst=1&labels=0&hard=1';
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
    c.defaultUnitCounters = { A: 1, B: 1 };
    c.units = [freshUnit({
            id: 'a1',
            name: 'チームAのキャラクター1',
            team: 'A',
            x: -10,
            y: 0,
            skills: []
        }), freshUnit({
            id: 'b1',
            name: 'チームBのキャラクター1',
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
// Upgrade only the original blank default unit names in existing saved formations.
// All other user-edited names remain unchanged.
for (const unit of config.units) {
    // Migrate older (up to 500 character) dialogue without breaking saved teams.
    unit.reactionLines = normalizedReactionLines(unit.reactionLines);
    if (unit.team === 'A' && unit.id === 'a1' && unit.name === 'チームAのキャラクター')
        unit.name = 'チームAのキャラクター1';
    if (unit.team === 'B' && unit.id === 'b1' && ['チームBのキャラクター', 'トリックスター'].includes(unit.name))
        unit.name = 'チームBのキャラクター1';
}
cleanWebConfiguration(config);
normalizeMoveModes(config);
deduplicateImportedSkills(config);
normalizeSettings(config);
if (config.initialLayoutVersion !== 2) {
    arrangeInitialPositions(config.units);
    config.initialLayoutVersion = 2;
}
const LOG_RENDER_BATCH = 700;
let logVisibleCount = LOG_RENDER_BATCH;
let selectedLogId = -1, logScrollTop = null, logScrollFrame = 0, unitTacticsImportTarget = null, reactionJsonImportTarget = null, characterJsonImportTarget = null, arenaImportTarget = null, arenaImportReport = null;
let mapZoom = 1, mapRelations = false, mapMoveCircle = false, mapFocus = 'selected', mapPan = { x: 0, y: 0 }, mapDrag = null;
const mobileExpandedRules = new Set([0]);
let shareImportActions = null, shareImportTargetId = null, shareImportBusy = false;
let shareExportTargetId = null, shareExportBusy = false;
let passivePreviewTurn = 0, passivePreviewHp = 'start', slotsExpanded = false, selectedSlotIndex = 0;
let aiSubTab = 'rules';
// Empty added inputs are UI-only until text is entered. Weak keys cannot leak to another imported roster.
const reactionEditorSelections = new WeakMap();
let guideTopicId = ''; // Within each page, keep the selected manual topic until navigation
const savedUi = readUiState(typeof sessionStorage === 'undefined' ? null : sessionStorage, config.units.map(u => u.id));
let page = savedUi.page, selected = savedUi.selected, skillSearch = savedUi.skillSearch, kindFilter = savedUi.kindFilter, skillFilter = savedUi.skillFilter, skillPage = savedUi.skillPage, sim = readReplayState(typeof sessionStorage === 'undefined' ? null : sessionStorage, Battle), frame = savedUi.frame, logType = savedUi.logType, logTurn = savedUi.logTurn, logSearch = savedUi.logSearch, worker = null, batch = null, batchCount = 100, busy = false, modalDraft = null, modalMode = 'skill', errors = [], saveFailed = false;
selectedLogId = savedUi.selectedLogId;
logScrollTop = savedUi.logScrollTop;
let lastReplayRef = sim, lastReplayTurn = sim?.turn ?? -1;
const OFFICIAL_BATTLE_STATE_KEY = 'battle-lab-official-arena-log-v1';
let officialArena = (() => { try { const cached=JSON.parse(sessionStorage.getItem(OFFICIAL_BATTLE_STATE_KEY) || 'null'); return cached?.schemaVersion === 7 ? cached : null; } catch { return null; } })();
let officialArenaUrl = officialArena?.sourceUrl || (officialArena?.id ? `https://rev2.reversion.jp/arena/battle/${officialArena.id}` : '');
let officialArenaTurn = 'all', officialLogMode = 'simple', officialArenaLoading = false;
let officialArenaStatusMessage = '';
let officialFrameIndex = null, officialPlaying = false, officialPlaybackTimer = null, officialScrollFrame = 0;
let expandedMapSource = 'local';
let initialRestoreScrollY = savedUi.scrollY;
function persistUi() {
    writeUiState(typeof sessionStorage === 'undefined' ? null : sessionStorage, {
        page, selected, skillSearch, kindFilter, skillFilter, skillPage,
        frame, selectedLogId, logScrollTop, logType, logTurn, logSearch,
        scrollY: initialRestoreScrollY ?? (typeof window === 'undefined' ? 0 : window.scrollY)
    });
    if (lastReplayRef !== sim || lastReplayTurn !== (sim?.turn ?? -1)) {
        writeReplayState(typeof sessionStorage === 'undefined' ? null : sessionStorage, sim);
        lastReplayRef = sim;
        lastReplayTurn = sim?.turn ?? -1;
    }
}

const $ = s => document.querySelector(s), app = $('#app');
$('#modal')?.addEventListener('close', () => $('#modal')?.classList.remove('manual-dialog')); // Escape also resets help-only styling.
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
const nf = x => Math.round(Number(x) || 0).toLocaleString('ja-JP');
const current = () => config.units.find(u => u.id === selected && canEditChallengeUnit(config,u)) || config.units.find(u=>canEditChallengeUnit(config,u)) || config.units[0];
const challenge = () => activeChallenge(config);
const allowUnit = (unit) => canEditChallengeUnit(config,unit);
function challengeInvalidMove(message='チャレンジ中は敵チームの設定を変更できません。') { toast(message); return true; }
if (challenge() && !allowUnit(config.units.find(u=>u.id===selected))) selected=current().id;
const openCharacterImport = createCharacterImporter({
    getConfig: () => config,
    getCurrent: () => current(),
    getChallenge: () => challenge(),
    onApply: (next, unit, summary) => {
        if (challenge() && (unit.team!=='A'||next.units.filter(u=>u.team==='A').length>challenge().teamALimit)) {
            toast('チャレンジの参加人数制限により追加できません。'); return;
        }
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
const unitSelect = () => select(Object.fromEntries(config.units.filter(allowUnit).map(u => [u.id, `${u.team}｜${u.name}`])), current().id, 'class="unit-selector" aria-label="編集するユニット" data-select-unit');
const unitTacticsControls = (showArenaActions = true) => {
    const basicButtons = `${btn('書き出し', 'export-unit-tactics', 'small', 'title="スキル・AIを書き出す" aria-label="選択中のキャラのスキル・AIを書き出す"')}${btn('読み込み', 'import-unit-tactics', 'small', 'title="スキル・AIを読み込む" aria-label="選択中のキャラにスキル・AIを読み込む"')}`;
    const arenaButtons = `${btn('アリーナ取込', 'import-arena-tactics', 'small', 'title="公式アリーナHTMLから戦術を読み込む" aria-label="公式アリーナHTMLから戦術を読み込む"')}${btn('共有コード読込', 'import-share-code', 'small', 'title="公式アリーナの共有コードからAIを読み込む"')}${btn('共有コード発行', 'open-share-export', 'small', 'title="選択したAIを公式アリーナの共有コードとして発行する"')}`;
    const buttons = basicButtons + (showArenaActions ? arenaButtons : '');
    return `<div class="unit-tactics-buttons desktop-tactics-controls" role="group" aria-label="スキル・AI管理"><span class="unit-tactics-label">スキル・AI</span>${buttons}</div><details class="mobile-tactics-details"><summary>スキル・AI管理</summary><div class="mobile-tactics-actions">${buttons}</div></details>`;
};

const helpButton = () => btn('?', 'page-help', 'small ghost help-button', 'aria-label="このページの使い方" title="このページの使い方"');
function guideTopicHtml(kind, topic) {
    const guide = PAGE_GUIDES[kind];
    return `<article class="guide-article" id="guide-article" tabindex="-1"><div class="guide-topic-header"><div class="eyebrow">${esc(guide.title)}</div><h3>${esc(topic.title)}</h3></div>`+
        (topic.intro ? `<p class="guide-intro">${esc(topic.intro)}</p>` : '')+
        `<ol class="guide-steps">${topic.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>`+
        (topic.note ? `<p class="guide-note"><strong>TIPS：</strong> ${esc(topic.note)}</p>` : '')+`</article>`;
}
function renderPageHelp(kind = page) {
    const guide=PAGE_GUIDES[kind] || PAGE_GUIDES.setup;
    if (!guide.topics.some(t=>t.id===guideTopicId)) guideTopicId=guide.topics[0].id;
    const topic=guide.topics.find(t=>t.id===guideTopicId) || guide.topics[0];
    const toc=guide.topics.map((t,i)=>btn(`<span class="guide-index">${String(i+1).padStart(2,'0')}</span><span>${esc(t.title)}</span>`,`guide-topic:${t.id}`,`guide-nav-button ${t.id===guideTopicId?'is-current':''}`,t.id===guideTopicId?'aria-current="true"':'')).join('');
    $('#modal').classList.add('manual-dialog');
    $('#modal').innerHTML=`<div class="modal-header guide-header"><div><div class="eyebrow">ページ別マニュアル</div><h2>${esc(guide.title)}</h2><p class="subtle">${esc(guide.lead)}</p></div>${btn('×','close-modal','ghost','aria-label="マニュアルを閉じる"')}</div>`+
        `<div class="guide-layout"><nav class="guide-toc" aria-label="${esc(guide.title)}の使い方・目次"><div class="guide-toc-heading">目次 <small>${guide.topics.length}項目</small></div>${toc}</nav><label class="guide-topic-mobile">内容を選択 ${select(Object.fromEntries(guide.topics.map(t=>[t.id,t.title])),guideTopicId,'data-guide-topic-select aria-label="マニュアル項目の選択"')}</label>${guideTopicHtml(kind,topic)}</div>`+
        `<div class="modal-footer guide-footer"><span>目次から知りたい操作を選べます</span>${btn('閉じる','close-modal','primary')}</div>`;
}
function openPageHelp(targetPage = page) {
    guideTopicId = PAGE_GUIDES[targetPage]?.topics[0]?.id || '';
    renderPageHelp(targetPage);
    $('#modal').showModal();
}
function render() {
    if (challenge() && !allowUnit(config.units.find(u=>u.id===selected))) selected=current().id;
    persistUi();
    const titles = { setup: '編成・ステータス', skills: 'スキルライブラリ', rules: 'キャラAI設定（β版）', sim: 'シミュレーション' };
    const mobileTitles = { setup: '編成', skills: 'スキル', rules: 'AI設定', sim: '戦闘' };
    const mobileNav = `<nav class="mobile-bottom-nav" aria-label="スマートフォン用メニュー">${Object.entries(mobileTitles).map(([k, v]) => btn(`${icon(k)}<span>${v}</span>`, `page:${k}`, page === k ? 'active' : '', `aria-label="${titles[k]}" ${page === k ? 'aria-current="page"' : ''}`)).join('')}</nav>`;
    const mobileTools = `<div class="mobile-top-tools"><button class="mobile-theme-toggle" type="button" data-act="toggle-theme" aria-label="${document.documentElement.dataset.theme === 'dark' ? 'ライトモードに変更' : 'ダークモードに変更'}" title="明暗の切替">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button>${helpButton()}${btn('データ管理', 'jump-data', 'mobile-data-shortcut')}</div>`;
    app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><strong>ロスアカ Battle Lab</strong><small>闘技趣味レーター</small>\
</div><div class="nav-label">メニュー</div><nav class="nav" aria-label="メインナビゲーション">${Object.entries(titles).map(([k, v]) => btn(`${icon(k)}<span>${v}</span>${k === 'skills' ? '<span class="count">220</span>' : ''}`, `page:${k}`, page === k ? 'active' : '')).join('')}</nav>\
<div class="sidebar-footer">${btn('データ管理', 'jump-data', 'sidebar-data-button')}${btn('このページの使い方', 'page-help', 'sidebar-data-button help-sidebar-button')}${btn('不具合を報告', 'open-bug-report', 'sidebar-bug-report')}<button type="button" class="theme-toggle" data-act="toggle-theme" aria-pressed="${document.documentElement.dataset.theme === 'dark'}" aria-label="画面の明暗を切り替える">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}<span class="theme-toggle-label">${document.documentElement.dataset.theme === 'dark' ? 'ライトモードに切替' : 'ダークモードに切替'}</span></button><span class="saved desktop-save-status" id="save-status">${saveFailed ? '保存できません' : 'ブラウザに自動保存'}</span><div class="version">Web版 1.18.21</div></div></aside><main class="main"><header class="topbar"><div class="mobile-top-brand">Battle Lab <small>v1.18.21</small></div><div class="breadcrumb">\
ロスアカ Battle Lab <span style="margin:0 9px;color:#a6aeb5">/</span> ${titles[page]}</div>\
<div class="top-actions"><span class="saved">${saveFailed ? '保存できません' : 'ブラウザに自動保存'}</span>${helpButton()}${btn('データ管理', 'jump-data', 'small')}</div>${mobileTools}</header><div class="content">${errors.length ? `<div class="error-box" role="alert">${errors.map(esc).join('<br>')}</div>` : ''}${({ setup: setupPage, skills: skillsPage, rules: rulesPage, sim: simPage }[page])()}</div>\
</main>${page === 'sim' && (sim || officialArena) ? `<aside id="mobile-replay-map" class="mobile-replay-map" hidden aria-label="ログ閲覧中の戦闘マップ"><button type="button" class="mobile-replay-map-button" data-act="map-expand" aria-label="現在の戦闘マップを拡大表示"><div id="mobile-replay-map-view" class="mobile-replay-map-view" aria-hidden="true"></div><span class="mobile-replay-map-caption"><span id="mobile-replay-map-turn">戦闘マップ</span><span>拡大 ↗</span></span></button></aside>` : ''}${mobileNav}</div>`;
    if (page === 'sim' && sim)
        bindReplay();
    if (page === 'sim' && officialArena?.frames?.length)
        bindOfficialReplay();
}
const heading = (eyebrow, title, subtitle, buttons = '', actionClass = '') => `<div class="page-heading"> <div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}</div>\
<div class="btnrow ${esc(actionClass)}">${buttons}</div>\
</div>`;
const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;
// v1.18.19: locally bundled pixel-art boss portrait; no enemy stats or AI are exposed.
function challengePortrait(challengeEntry, extraClass = '') {
    return challengeEntry?.icon
        ? `<img class="challenge-portrait ${esc(extraClass)}" src="${esc(challengeEntry.icon)}" width="48" height="48" alt="" loading="lazy" decoding="async">`
        : '';
}
function unitAvatar(team, index, unit) {
    const bossChallenge = challenge();
    const isBoss = team === 'B' && bossChallenge && unit?.id === CHALLENGE_BOSS_ID;
    return `<span class="avatar ${team === 'B' ? 'enemy' : ''}${isBoss ? ' challenge-avatar' : ''}">${isBoss ? challengePortrait(bossChallenge, 'challenge-avatar-image') : `${team}${index + 1}`}</span>`;
}
function teams() {
    const canAdd = config.units.length < 16;
    const active = challenge();
    const strips = ['A', 'B'].map(team => {
        const members = config.units.filter(unit => unit.team === team);
        const chips = members.map((unit, index) => btn(`${unitAvatar(team, index, unit)}\
<span><strong>${esc(unit.name)}</strong>\
<small>${active && team==='B' ? 'チャレンジ専用・設定非公開' : `HP ${nf(unit.maxHp)} · SPD ${nf(unit.speed)}`}</small>\
</span>`, `unit:${unit.id}`, `unit-chip ${unit.id === selected ? 'selected' : ''}`, active && team==='B'?'disabled title="チャレンジの敵は選択できません"':'')).join('');
        return `<div class="team-strip ${team === 'B' ? 'enemy' : ''}"><div class="team-title"><b>チーム${team} <span style="font-size:9px;font-weight:400;margin-left:8px">${team === 'A' ? '自チーム' : '相手チーム'}</span>\
</b><span class="subtle">${members.length}人</span>\
</div><div class="unit-row">${chips}${btn('+', `add-unit:${team}`, 'add-chip', `aria-label="チーム${team}にユニットを追加" ${canAdd && (!active || team==='A' && members.length<active.teamALimit) ? '' : 'disabled'}`)}</div>\
</div>`;
    });
    return `<div class="teams">${strips.join('')}</div>`;
}
function map(units = config.units, large = false, expanded = false, compact = false, context = null) {
    const official = context?.source === 'official';
    const size = official ? context.mapSize || 150 : config.settings.mapSize || 150, half = size / 2, w = expanded ? 1050 : large ? 540 : 300, h = expanded ? 680 : large ? 340 : 205;
    const scale = Math.min((w - 40) / size, (h - 24) / size), cx = w / 2, cy = h / 2;
    // The floating thumbnail is always an overview, independent of the dialog zoom/pan.
    const viewport = mapViewport(w, h, scale, compact ? 1 : mapZoom, compact ? { x: 0, y: 0 } : mapPan, size);
    let grid = '';
    for (let v = -half; v <= half; v += 10) {
        const x = cx + v * scale, y = cy + v * scale;
        grid += `<path d="M${x} 10v${h - 20}M10 ${y}h${w - 20}" stroke="#dce5d7" stroke-width=".65"/>`;
    }
    const inReplay = page === 'sim';
    const actionActorId = official ? (context.actorId ?? null) : (inReplay && sim ? replayActorId(sim.logs, sim.frames, frame, selectedLogId) : null);
    const focusId = mapFocus === 'selected' ? (inReplay ? actionActorId : selected) : mapFocus;
    const links = !compact && mapRelations ? mapRelationPairs(units.filter(u=>Number.isFinite(u.x)&&Number.isFinite(u.y)), focusId) : [];
    const connections = links.map(({ from, to, distance, direction }, index) => {
        const x1 = cx + from.x * scale, y1 = cy - from.y * scale, x2 = cx + to.x * scale, y2 = cy - to.y * scale;
        const mx = (x1 + x2) / 2 + (index % 2 ? 5 : -5), my = (y1 + y2) / 2 + ((index % 3) - 1) * 13;
        const label = distance.toFixed(1) + 'm';
        const labelWidth = Math.max(24, label.length * 5.4 + 8);
        return `<g class="map-relation" data-from="${esc(from.id)}" data-to="${esc(to.id)}"><title>${esc(from.name)} → ${esc(to.name)}: ${label}・${direction}</title>\
<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${from.team === to.team ? '#6796a2' : '#a97760'}" stroke-width="1.2" stroke-dasharray="${from.team === to.team ? '3 3' : 'none'}" opacity=".72"/>${links.length <= 8 ? `<rect x="${mx - labelWidth / 2}" y="${my - 8.5}" width="${labelWidth}" height="13" rx="4" fill="#fff" fill-opacity=".94" stroke="#d8dfd4" stroke-width=".5"/>\
<text x="${mx}" y="${my + 1}" font-size="8.5" text-anchor="middle" fill="#233e32" font-weight="650">${label}</text>` : ''}</g>`;
    }).join('');
    const markers = units.filter(u=>Number.isFinite(u.x)&&Number.isFinite(u.y)).map(u => {
        const x = cx + u.x * scale, y = cy - u.y * scale, markerRadius = Math.min(9, Math.max(3.5, 5 * scale * .44)), color = u.team === 'A' ? '#4f8362' : '#b47961';
        // The challenge boss uses its portrait INSTEAD OF the default B1 circle and halo.
        // Both normal and expanded maps use this same renderer; ordinary units are unaffected.
        const portrait = !official && u.team === 'B' && u.id === CHALLENGE_BOSS_ID ? challenge()?.icon : null;
        const marker = portrait
            ? `<image href="${esc(portrait)}" x="${x - 10}" y="${y - 10}" width="20" height="20" preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated"/>`
            : `<circle cx="${x}" cy="${y}" r="${u.id === (inReplay ? actionActorId : selected) ? 19 : 15}" fill="${color}" opacity=".10"/>\
<circle cx="${x}" cy="${y}" r="${markerRadius}" fill="${color}" stroke="#fff" stroke-width="2"/>\
<text x="${x}" y="${y + 3}" font-size="${Math.min(7, markerRadius * 1.3)}" fill="white" text-anchor="middle">${u.team}${units.filter(z => z.team === u.team).findIndex(z => z.id === u.id) + 1}</text>`;
        return `<g data-map-unit="${esc(u.id)}" data-x="${u.x}" data-y="${u.y}" opacity="${u.alive === false ? .3 : 1}"><title>${esc(u.name)} (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) m</title>\
${marker}${large || expanded ? `<text x="${x}" y="${y + 25}" text-anchor="middle" fill="${color}" font-size="9">${esc(u.name)}</text>` : ''}</g>`;
    }).join('');
    const movementUnit = units.find(u => u.id === (inReplay ? actionActorId : selected));
    const baseMobility = official ? 0 : Math.max(0, Number(config.units.find(u => u.id === movementUnit?.id)?.mobility) || 0);
    const moveRadius = baseMobility * 10;
    const maskId = 'move-bounds-' + (compact ? 'thumbnail' : expanded ? 'dialog' : large ? 'replay' : 'setup');
    const movementDisk = !official && !compact && mapMoveCircle && movementUnit && moveRadius > 0 ? `<g class="map-movement-disk" clip-path="url(#${maskId})" data-map-move-unit="${esc(movementUnit.id)}" data-map-move-radius="${moveRadius}">\
<title>${esc(movementUnit.name)}：基礎機動力${baseMobility}、通常移動で最大${moveRadius}m</title>\
<circle cx="${cx + movementUnit.x * scale}" cy="${cy - movementUnit.y * scale}" r="${moveRadius * scale}" fill="#5b91af" fill-opacity=".095" stroke="#3b7da2" stroke-width="1.5" stroke-dasharray="5 3"/>\
</g>` : '';
    const positionOptions = {
        selected: inReplay ? '行動中のキャラ' : '編集中のキャラ',
        all: '全キャラ同士',
        ...Object.fromEntries(units.map(u => [u.id, `${u.team}｜${u.name}`]))
    };
    const controls = compact ? '' : `<div class="map-tools"><label class="checkbox-label"><input type="checkbox" data-map-relations ${mapRelations ? 'checked' : ''}>\
位置関係・距離を表示</label>${official ? '' : `<label class="checkbox-label"><input type="checkbox" data-map-movement ${mapMoveCircle ? 'checked' : ''}>\
移動可能範囲を表示</label>`}<div class="map-zoom-controls"><button type="button" class="small" data-act="map-zoom-out" ${mapZoom === 1 ? 'disabled' : ''} aria-label="マップを縮小">\
－</button><output aria-label="マップの倍率">${Math.round(mapZoom * 100)}%</output>\
<button type="button" class="small" data-act="map-zoom-in" ${mapZoom === 4 ? 'disabled' : ''} aria-label="マップを拡大">\
＋</button><button type="button" class="small" data-act="map-center" ${mapZoom === 1 ? 'disabled' : ''}>\
中心に戻す</button>${expanded ? '' : btn('拡大表示', official ? 'official-map-expand' : 'map-expand', 'small')}</div>\
</div>${mapRelations ? `<div class="map-focus-row">\
<label>線を表示する組み合わせ ${select(positionOptions, mapFocus, 'data-map-focus aria-label="位置関係の比較対象"')}</label>\
<span class="subtle">実線：敵味方間／点線：同チーム</span></div>` : ''}`;
    const movementLegend = !official && !compact && mapMoveCircle ? `<div class="map-focus-row"><span class="subtle">${movementUnit ? `${esc(movementUnit.name)}：基礎機動力 ${baseMobility} × 10m ＝ 移動半径 ${moveRadius}m` : 'この時点では行動中のキャラがいません'}（戦闘中の機動力補正は別途適用）</span>\
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
    if (!thumbnail) return;
    const useOfficial = Boolean(officialArena?.frames?.length && $('#official-replay-map'));
    const show = useOfficial ? officialReplayFrame() : null;
    if (!useOfficial && !sim) return;
    thumbnail.innerHTML = useOfficial ? map(show.units, false, false, true, officialMapContext(show)) : map(units, false, false, true);
    const label = $('#mobile-replay-map-turn');
    const log = sim?.logs.find(entry => entry.id === selectedLogId);
    if (label) label.textContent = useOfficial ? `公式 T${show.turn} マップ` : log ? `T${String(log.turn).padStart(2, '0')} マップ` : 'マップ';
    const button = $('.mobile-replay-map-button');
    if (button) button.dataset.act = useOfficial ? 'official-map-expand' : 'map-expand';
}
function updateMobileReplayMapVisibility() {
    const floating = $('#mobile-replay-map');
    if (!floating) return;
    const useOfficial=Boolean(officialArena?.frames?.length && $('#official-replay-map'));
    const logs = useOfficial ? $('#official-log-list') : $('#log-entries'), original = useOfficial ? $('#official-replay-map') : $('#replay-map');
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
    if ($('#official-replay-map') && officialArena?.frames?.length) paintOfficialReplay();
    repaintExpandedMap();
}
function repaintExpandedMap() {
    const el = $('#map-dialog-content');
    if (el && $('#map-dialog')?.open) {
        const official=expandedMapSource==='official'&&officialArena?.frames?.length;
        const current=official?officialReplayFrame():null;
        el.innerHTML = official ? map(current.units,true,true,false,officialMapContext(current)) : map(currentMapUnits(),true,true);
    }
}
function openExpandedMap(source = 'local') {
    expandedMapSource = source;
    const dlg = $('#map-dialog');
    if (!dlg)
        return;
    dlg.showModal();
    repaintExpandedMap();
}
function conditionalPassivesDisplay(u) {
    const list = u.conditionalPassives;
    if (!Array.isArray(list) || !list.length) return '';
    const selection = conditionalPassivePreviewOptions(u, passivePreviewTurn, passivePreviewHp);
    const {turn, hpPct, elapsedTurns, hpThresholds} = selection;
    const preview = passiveStatusPreview(u, turn, hpPct);
    const keys = [...new Set(list.flatMap(p => Object.keys(p.modifiers || {})))];
    const effectKeys = [...new Set(list.flatMap(p => Object.keys(p.effects || {})))];
    const choices = (items, selected) => items.map(([v, label]) =>
        `<option value="${v}" ${String(v) === String(selected) ? 'selected' : ''}>${label}</option>`).join('');
    const turnControl = elapsedTurns.length > 1 ?
        `<label>経過ターン<select data-passive-preview-turn aria-label="経過ターン">${choices(elapsedTurns.map(t => [t, `${t}T`]), turn)}</select></label>` :
        elapsedTurns.length ? `<span class="passive-preview-context">経過 ${turn}T</span>` : '';
    const hpControl = hpThresholds.length > 1 ?
        `<label>HP条件<select data-passive-preview-hp aria-label="HPの発動条件">${choices(hpThresholds.map(p => [p, `${p}%`]), hpPct)}</select></label>` :
        hpThresholds.length ? `<span class="passive-preview-context">HP ${hpPct}%</span>` : '';
    const filters = turnControl || hpControl ? `<div class="passive-preview-filters">${turnControl}${hpControl}</div>` : '';
    return `<section class="conditional-passive-section" aria-label="条件付きパッシブ"><div class="field-section">条件付きパッシブ</div>
<div class="conditional-passive-list">${list.map((p, passiveIndex) => {
        const info = conditionalPassiveDescription(p, STAT_LABELS);
        const state = conditionalPassiveState(u, p, turn, hpPct);
        return `<div class="conditional-passive-item"><strong>${esc(p.name)}</strong><span>${esc(info.heading.replace(/（[^）]*）/g, ''))}</span><span class="conditional-passive-state ${state.active ? 'is-active' : 'is-inactive'}">${esc(state.label)}</span>${btn('削除', `remove-unit-passive:${passiveIndex}`, 'small danger')}<small>${info.values.map(esc).join(' / ')}</small></div>`;
    }).join('')}</div>
<div class="passive-preview" aria-label="条件付きパッシブ適用後のステータス">
<div class="passive-preview-head"><strong>戦闘中の実効値</strong>${filters}</div>
${keys.length ? `<div class="effective-stat-grid">${keys.map(k => {
    const delta = preview.stats[k] || 0, base = Number(u[k]) || 0;
    return `<div class="effective-stat"><span>${esc(STAT_LABELS[k] || k)}</span><strong>${nf(base + delta)}</strong><small>基礎 ${nf(base)} ${delta >= 0 ? '+' : '−'} ${nf(Math.abs(delta))}</small></div>`;
}).join('')}</div>` : ''}
${effectKeys.length ? `<div class="passive-effect-preview">${effectKeys.map(k =>
    `<span class="pill">${esc(EFFECTS[k] || k)} ${nf(preview.effects[k])}</span>`).join('')}</div>` : ''}
</div></section>`;
}
/** Keep the official imported baseline editable, but show its current effective value next to it. */
function passiveAwareStatField(u, key, extra = '', label = STAT_LABELS[key]) {
    const basic = input(key, u[key], extra);
    const relevant = Array.isArray(u.conditionalPassives) &&
        u.conditionalPassives.some(p => Number(p?.modifiers?.[key]));
    if (!relevant) return field(label, basic);
    const {turn, hpPct, elapsedTurns, hpThresholds} = conditionalPassivePreviewOptions(u, passivePreviewTurn, passivePreviewHp);
    const delta = Number(passiveStatusPreview(u, turn, hpPct).stats[key]) || 0;
    const currentValue = Number(u[key]) || 0;
    const signed = delta >= 0 ? `+${nf(delta)}` : `−${nf(Math.abs(delta))}`;
    const context = [elapsedTurns.length ? `${turn}T` : '', hpThresholds.length ? `HP${nf(hpPct)}%` : ''].filter(Boolean).join('・');
    return field(label, `${basic}<small class="stat-passive-effective">実効値 ${nf(currentValue + delta)}（補正 ${signed}${context ? `／${context}` : ''}）</small>`);
}
function importedEffectsDisplay(u) {
    const entries = Object.entries(u.effects || {}).filter(([key, value]) => Object.hasOwn(EFFECTS, key) && Number.isFinite(value) && value !== 0);
    if (!entries.length) return '';
    return `<section class="imported-effects-section"><div class="field-section">その他のステータス（常時特殊効果）</div>
<div class="imported-effects-list">${entries.map(([key, value]) => `<div class="imported-effect-item"><span class="pill">${esc(EFFECTS[key])} ${nf(value)}</span>${btn('削除', `remove-unit-effect:${key}`, 'small danger')}</div>`).join('')}</div>
</section>`;
}
function importedProfileDetails(u) {
    const p = u.importedProfile;
    if (!p)
        return '';
    return `<details class="accordion"><summary>読み込んだキャラクターの参照情報</summary><p class="footnote"><a href="${esc(p.url)}" rel="noreferrer">${esc(p.characterId)} ↗</a>\
 / ${esc(new Date(p.fetchedAt).toLocaleString('ja-JP'))}</p>${(p.warnings || []).map(w => `<p class="import-warning">${esc(w)}</p>`).join('')}${(p.unsupported || []).map(s => `<div class="source-quote">\
未セット：${esc(s.name)}<br>${esc(s.original)}<br>\
未対応：${s.issues.map(esc).join('、')}</div>`).join('')}</details>`;
}
function characterSlotsPanel() {
    const slots = readCharacterSlots(typeof localStorage === 'undefined' ? null : localStorage);
    const safeIndex = Number.isInteger(selectedSlotIndex) && selectedSlotIndex>=0 && selectedSlotIndex<CHARACTER_SLOT_COUNT ? selectedSlotIndex : 0;
    const saved = slots[safeIndex];
    const slotOptions = Object.fromEntries(slots.map((entry,i) => [String(i), `${String(i+1).padStart(2,'0')}｜${entry ? entry.name : '空きスロット'}`]));
    const selectedUnitOptions = Object.fromEntries(config.units.filter(allowUnit).map(unit => [unit.id, `${unit.team}｜${unit.name}`]));
    const description = saved ? `<div class="slot-selected-info"><strong>${esc(saved.name)}</strong><span>元チーム ${esc(saved.team)} ／ 装備 ${saved.snapshot?.tactics?.skills?.length || 0}種 ／ AI ${saved.snapshot?.tactics?.rules?.length || 0}件</span></div>` : '<div class="slot-selected-info"><strong>空きスロット</strong><span>選択中のキャラを保存できます</span></div>';
    return `<details class="data-management-group character-slots-details" id="character-slots-panel" ${slotsExpanded ? 'open' : ''}><summary>キャラスロット（${slots.filter(Boolean).length}/${CHARACTER_SLOT_COUNT}）</summary>`+
        `<div class="character-slots-compact"><div class="slot-select-grid"><label class="slot-select-field"><span>キャラ選択（保存元）</span>${select(selectedUnitOptions, selected, 'data-slot-unit-select aria-label="保存元のキャラ選択"')}</label>`+
        `<label class="slot-select-field"><span>キャラスロット</span>${select(slotOptions, String(safeIndex), 'data-character-slot-select aria-label="キャラスロット番号"')}</label></div>`+
        description+`<div class="character-slot-actions">${btn(saved?'上書き保存':'このキャラを保存',`slot-save:${safeIndex}`,'small slot-save-button')}`+
        `${btn('Aへ読込',`slot-load:${safeIndex}:A`,'small primary',saved && (!challenge() || config.units.filter(x=>x.team==='A').length<challenge().teamALimit) ? '' : 'disabled title="保存データがないか参加人数上限です"')}`+
        `${btn('Bへ読込',`slot-load:${safeIndex}:B`,'small',saved && !challenge()?'':'disabled title="チャレンジ中はチームBを変更できません"')}`+
        `${btn('空にする',`slot-clear:${safeIndex}`,'small danger',saved?'':'disabled title="すでに空です"')}</div>`+
        `<p class="slot-small-note">スロットは編成から独立して保存されます。キャラを削除しても復元可能です（ブラウザ内保存・端末間同期なし）。</p></div></details>`;
}
function setupPage() {
    const u = current();
    return heading('BATTLE CONFIGURATION', '編成・ステータス', '', btn('キャラ検索', 'character-import') + btn('チャレンジ', 'open-challenges', 'small') + btn('キャラスロット', 'jump-slots', 'small') + btn(`${icon('sim', 'inline-icon')}実行画面へ`, 'page:sim', 'primary'), 'setup-quick-actions') + (challenge()?`<section class="challenge-active-banner"><div class="challenge-banner-identity">${challengePortrait(challenge(), 'challenge-banner-portrait')}<div><strong>${esc(challenge().title)}（${esc(challenge().difficulty)}）</strong><span>チームA ${challenge().teamALimit}人まで・チームBは固定／能力値・AI非公開</span></div></div>${btn('通常編成に戻す','challenge-end','small')}</section>`:'') + teams() + `<div class="two-col">\
<section class="panel"><div class="panel-head"><div><h2>${esc(u.name)} <span class="rule-count">\
/ TEAM ${u.team}</span>\
</h2></div><div class="btnrow">${btn('複製', 'clone-unit', 'small',challenge() && config.units.filter(x=>x.team==='A').length>=challenge().teamALimit ?'disabled title="チャレンジ参加人数上限"':'')}${btn('削除', 'delete-unit', 'small danger',challenge()?'disabled title="チャレンジ中は最後の参加者を削除できません"':'')}</div>\
</div><div class="panel-body"><div class="fields two">${field('ユニット名', `<input data-unit="name" value="${esc(u.name)}" maxlength="50">`)}${field('陣営', challenge()?'<strong class="challenge-locked-team">チームA / チャレンジ参加者</strong>':select({ A: 'チームA / 自チーム', B: 'チームB / 相手チーム' }, u.team, 'data-unit="team"'))}</div>\
<div class="field-section">耐久・リソース</div><div class="fields two"><div class="meter-field">${passiveAwareStatField(u, 'maxHp', 'min="1"', 'MAX HP')}<div class="bar">\
</div></div><div class="meter-field ap">${passiveAwareStatField(u, 'maxAp', 'min="0"', 'MAX AP')}<div class="bar">\
</div></div></div><div class="field-section">攻撃・防御</div><div class="fields">${[
        'main',
        'sub',
        'heal',
        'hit',
        'evade',
        'defense',
        'resist'
    ].map(k => passiveAwareStatField(u, k)).join('')}</div><div class="field-section">行動・判定</div><div class="fields">${[
        'speed',
        'mobility',
        'critical',
        'fumble',
        'drama'
    ].map(k => passiveAwareStatField(u, k)).join('')}${field('通常攻撃の射程', select(RANGES, u.normalRange, 'data-unit="normalRange"'))}</div>\
<details class="accordion normal-attack-bs"><summary>通常攻撃：BS <span class="bs-count" data-normal-bs-count>（${(u.normalBS || []).length}種類）</span></summary><div class="normal-bs-checks">${BS_NAMES.map(b => `<label class="normal-bs-check"><input type="checkbox" value="${esc(b)}" data-unit-normal-bs ${(u.normalBS || []).includes(b) ? 'checked' : ''}><span>${esc(b)}</span></label>`).join('')}</div><p class="footnote">チェックしたBSが通常攻撃の命中時に付与判定されます。複数選べます。</p></details>\
${conditionalPassivesDisplay(u)}${importedEffectsDisplay(u)}<div class="field-section">属性（ダメージ補正のみ）</div><div class="element-single">${field('属性', `<select data-element-key><option value="" ${!u.element?.key ? 'selected' : ''}>未設定</option>${ELEMENT_KEYS.map(k => `<option value="${k}" ${u.element?.key === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}${field('属性値', `<input type="number" min="0" max="1000000" step="1" inputmode="numeric" data-element-value value="${u.element?.value ?? 0}" ${!u.element?.key ? 'disabled' : ''}>`)}<span class="element-level" data-element-level>Lv${elementLevel(u.element?.value)}</span></div>\
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
上のルールから順に判定し、実行できる最初の行動を選択します。</div></div></section><section class="panel"><div class="panel-body" id="data-management-panel"><div class="data-management-heading"><h3>データ管理</h3><span class="subtle">自動保存中</span></div>
<p class="subtle data-management-unit">対象：${esc(u.name)}</p>
${characterSlotsPanel()}
<details class="data-management-group" open><summary>キャラクターJSON</summary><div class="data-management-actions">
${btn('書き出す', 'export-character', 'small')}${btn('読み込む', 'import-character', 'small')}</div>
<p class="footnote">能力値・特殊効果・装備・AIをまとめて管理します。</p></details>
<details class="data-management-group"><summary>スキル・AIのみ</summary><div class="data-management-actions">
${btn('書き出す', 'export-unit-tactics', 'small')}${btn('読み込む', 'import-unit-tactics', 'small')}</div></details>
<details class="data-management-group"><summary>公式アリーナAI</summary><div class="data-management-actions">
${btn('アリーナ取込', 'import-arena-tactics', 'small')}${btn('共有コード読込', 'import-share-code', 'small')}${btn('共有コード発行', 'open-share-export', 'small')}</div></details>
<div class="data-management-reset">${btn('初期編成に戻す', 'reset-config', 'small danger')}</div></div>\
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
    const bossCustomIds=new Set(challenge()?(config.units.find(v=>v.team==='B')?.skills||[]).filter(id=>!id.startsWith('wiki-') && !u.skills.includes(id)):[]);
    const specialIds = new Set(Object.keys(u.specializedSkills || {}));
    const characterSpecialIds = new Set(config.units.flatMap(unit => Object.keys(unit.specializedSkills || {})));
    const matches = s => {
        if (bossCustomIds.has(s.id))return false;
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
<label class="skill-target-select"><span class="skill-target-label">装備先</span>${unitSelect()}</label>${pill(`${u.skills.length} スキルをセット中`, 'green')}${unitTacticsControls(false)}</div>\
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
function editableReactionKeys(u) {
    let keys = reactionEditorSelections.get(u);
    if (!keys) { keys = new Set(); reactionEditorSelections.set(u,keys); }
    for (const def of REACTION_DEFINITIONS) {
        if (typeof u.reactionLines?.[def.key] === 'string' && u.reactionLines[def.key].trim()) keys.add(def.key);
    }
    return keys;
}
function reactionEditorPage(u) {
    const active=editableReactionKeys(u);
    const remaining=REACTION_DEFINITIONS.filter(d=>!active.has(d.key));
    const groups=[...new Set(REACTION_DEFINITIONS.map(d=>d.group))];
    const picker=`<div class="reaction-add-row"><label for="reaction-add-select">演出を追加</label>
       <select id="reaction-add-select" data-add-reaction aria-label="追加する演出を選択" ${remaining.length?'':'disabled'}>
         <option value="" selected>${remaining.length?'追加する演出を選択':'すべての演出を追加済み'}</option>
         ${groups.map(g=>{const entries=remaining.filter(d=>d.group===g);return entries.length?`<optgroup label="${esc(g)}">${entries.map(d=>`<option value="${d.key}">${esc(d.label)}（${d.chance}%）</option>`).join('')}</optgroup>`:'';}).join('')}
       </select></div>`;
    const rows=groups.map(group=>{
        const defs=REACTION_DEFINITIONS.filter(d=>d.group===group && active.has(d.key));
        return defs.length?`<section class="reaction-editor-group"><h2>${esc(group)}</h2><div class="reaction-editor-grid">${defs.map(d=>`
          <div class="reaction-editor-item"><label for="reaction-line-${d.key}" class="reaction-editor-label">${esc(d.label)} <small>表示 ${d.chance}%</small></label>
          <div class="reaction-editor-input-row"><textarea id="reaction-line-${d.key}" data-reaction-key="${d.key}" rows="1" maxlength="${MAX_REACTION_LENGTH}" placeholder="80文字以内">${esc(u.reactionLines?.[d.key]||'')}</textarea>
          ${btn('削除',`remove-reaction:${d.key}`,'small ghost','aria-label="'+esc(d.label)+'を削除"')}</div></div>`).join('')}</div></section>`:'';
    }).join('');
    return picker+`<div class="reactions-editor">${rows}</div>`;
}
function rulesPage() {
    const u=current();
    const tabs = `<div class="ai-settings-tabs" role="tablist" aria-label="AI設定の種類"><button type="button" role="tab" data-act="ai-tab:rules" aria-selected="${aiSubTab==='rules'}" class="${aiSubTab==='rules'?'active':''}">行動ルール</button><button type="button" role="tab" data-act="ai-tab:reactions" aria-selected="${aiSubTab==='reactions'}" class="${aiSubTab==='reactions'?'active':''}">演出（セリフ）</button></div>`;
    if(aiSubTab==='reactions') return heading('REACTION SETTINGS', 'キャラAI設定（β版）', '戦闘に応じたセリフを設定します。') + tabs + `<div class="toolbar-secondary tactics-toolbar">${unitSelect()}<div class="unit-tactics-buttons reaction-json-controls" role="group" aria-label="セリフJSON管理">${btn('セリフJSON書き出し','export-reaction-json','small')}${btn('セリフJSON読み込み','import-reaction-json','small')}</div></div>` + reactionEditorPage(u);
    return heading('ACTION RULE BUILDER', 'キャラAI設定（β版）', '公式アリーナの条件・行動・対象・位置取り定義（2026年11月16日取得）に準拠。上から順に判定します。', btn('AI設定追加', 'add-rule', 'primary', u.rules.length >= ARENA_MAX_RULES ? 'disabled title="公式の最大20件"' : '')) + tabs + (arenaImportReport && arenaImportReport.unitId === u.id ? `<section class="notice arena-import-report">\
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

function officialBattlePanel() {
    const loaded = officialArena;
    return `<details class="panel official-battle-panel" ${loaded ? 'open' : ''}>
      <summary class="official-battle-summary"><strong>公式戦闘・訓練ログを取り込む</strong><span class="subtle">公開結果URL、または保存した公式JSONに対応</span></summary>
      <div class="panel-body">
        <div class="official-battle-controls"><label class="field"><span>公式闘技場・訓練メニューの結果URL</span><input id="official-battle-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://rev2.reversion.jp/arena/training/6/result/438580" value="${esc(officialArenaUrl)}"></label>${btn(officialArenaLoading ? '取得中…' : '取得して表示','load-official-battle','primary',officialArenaLoading?'disabled':'')}${btn('JSONから取込','import-official-json','small ghost')}${loaded?btn('表示を消す','clear-official-battle','small ghost'):''}</div>
        <p id="official-battle-status" class="subtle" role="status" aria-live="polite">${esc(officialArenaStatusMessage || (loaded?'公式ログを表示しています。ローカルのシミュレーション結果には影響しません。':'公開されている対戦・訓練結果URLを入力してください。'))}</p>
        ${loaded ? officialBattleContent(loaded) : ''}
      </div>
    </details>`;
}
function officialReplayFrame() {
    if(!officialArena?.frames?.length)return null;
    const index=officialFrameIndex==null ? officialArena.frames.length-1 : Math.max(0,Math.min(officialArena.frames.length-1,officialFrameIndex));
    return officialArena.frames[index];
}
function officialMapContext(f) {return {source:'official',mapSize:officialArena?.mapSize||150,actorId:f?.actorId||null};}
function officialLogRow(log) {
    const kind=officialArenaLogTypeLabel(log.type);
    const body=String(log.displayText??log.text??'');
    const actor=log.actorName?`<strong>${esc(log.actorName)}</strong>：`:'';
    const ownRoll=officialLogMode==='all'&&log.roll&&body!==log.roll?`<small class="official-log-roll">判定・出目：${esc(log.roll)}</small>`:'';
    const mergedNotes=log.notes?.filter(Boolean)||[];
    const concise=officialLogMode==='simple'&&mergedNotes.length
        ? `<small class="official-log-brief">${esc(mergedNotes.join(' ／ '))}</small>` : '';
    const mergedDetails=officialLogMode==='all'&&log.parts?.length
        ? `<span class="official-log-merged">${log.parts.map(part=>{
            const detail=part.detailLabel||officialArenaLogTypeLabel(part.type);
            const message=part.text ? `<span>${esc(part.text)}</span>` : '';
            const formula=part.roll ? `<small>判定・出目：${esc(part.roll)}</small>` : '';
            return `<span class="official-log-subrow"><b>${esc(detail)}</b>${message}${formula}</span>`;
        }).join('')}</span>` : '';
    const stateClass=log.kind==='state'?' official-log-state':'';
    const rollClass=/(?:_ROLL$|EFFECT_TRIGGER$)/.test(String(log.type||''))?' official-log-judge':'';
    return `<button type="button" class="official-log-row${stateClass}${rollClass}" data-act="official-select-log:${log.id}" data-official-log-index="${log.id}" aria-label="第${log.turn}ターン：${esc(kind)} ${esc(log.actorName)} ${esc(body).slice(0,140)}"><span class="official-log-text"><span class="official-log-kind">${esc(kind)}</span> ${actor}<span class="official-log-message">${esc(body)}</span>${ownRoll}${concise}${mergedDetails}</span></button>`;
}
function officialBattleContent(battle) {
    const allTurns=[...new Set(battle.logs.map(l=>l.turn))].sort((a,b)=>a-b);
    const chosen=officialArenaTurn==='all'?'all':Number(officialArenaTurn);
    const activeLogs=battle.logs.filter(l=>chosen==='all'||l.turn===chosen);
    const groupedLogs=officialArenaDisplayGroups(activeLogs,{mode:officialLogMode,members:battle.teams.flatMap(team=>team.members||[])});
    const visibleCount=groupedLogs.reduce((total,group)=>total+group.rows.length,0);
    const replay=battle.frames?.length ? (officialReplayFrame()||battle.frames.at(-1)) : null;
    return `<div class="official-battle-result"><div class="official-result-head"><div><strong>${esc(battle.name)}</strong><div class="subtle">公式ログ / ${battle.counts.entries.toLocaleString('ja-JP')}件・${battle.counts.turns}T</div></div>${battle.sourceUrl?`<a href="${esc(battle.sourceUrl)}" rel="noreferrer">公式ページを開く ↗</a>`:`<span class="subtle">JSONから取り込んだログ</span>`}</div>
        ${renderCombatStatistics(officialArenaStatistics(battle),battle.counts.turns,{official:true,title:'公式ログ：キャラ別・戦闘全体の統計'})}
        ${replay?`<div class="result-grid replay-layout official-replay-layout">
        <aside class="replay-sidebar official-replay-sidebar"><section class="panel"><div class="panel-head"><h2>公式戦闘マップ</h2>${pill('記録された位置・HP/AP','green')}</div><div class="panel-body"><p id="official-replay-label" class="replay-label"></p><div id="official-replay-map"></div>
        <div class="official-replay-controls"><button type="button" data-act="official-replay-first" aria-label="公式リプレイの最初に戻る">|◀</button><button type="button" id="official-replay-play" data-act="official-replay-play" aria-label="公式リプレイを再生する">▶ 再生</button><button type="button" data-act="official-replay-last" aria-label="公式リプレイの最後へ">▶|</button></div>
        <div class="official-replay-slider"><span>開始</span><input type="range" id="official-frame-range" min="0" max="${battle.frames.length-1}" value="${Math.max(0,officialFrameIndex??battle.frames.length-1)}" aria-label="公式リプレイ時点"><span>終了</span></div><p class="subtle official-replay-note">スライダーや戦闘ログを選ぶと、その時点の位置とHP/APに切り替わります。</p>
        </div></section><section class="panel"><div class="panel-head"><h2>ユニットの状態</h2></div><div id="official-replay-units" class="panel-body"></div></section></aside>
        <section class="panel replay-log-panel official-replay-log-panel"><div class="panel-head"><h2>公式戦闘ログ</h2></div>
        <div class="panel-body"><div class="official-log-title"><label class="field"><span>ターン</span>${select({all:'全ターン',...Object.fromEntries(allTurns.map(t=>[t,`第${t}ターン`]))},officialArenaTurn,'id="official-battle-turn" aria-label="公式ログのターン"')}</label><label class="field official-log-mode-field"><span>表示形式</span>${select({simple:'簡易表示',all:'全表示'},officialLogMode,'id="official-log-mode" aria-label="公式ログの表示形式"')}</label><span class="subtle">表示 ${visibleCount}件 / 原本 ${activeLogs.length}件</span></div>
        <div id="official-log-list" class="official-log-list" tabindex="0" aria-label="公式戦闘ログ。選択した記録にマップとHP/APが連動します">${groupedLogs.map(group=>`<section class="official-turn-group"><h4>${group.turn===0?'戦闘開始前':`第${group.turn}ターン`}</h4>${group.rows.map(log=>officialLogRow(log)).join('')||'<p class="subtle official-log-empty">このターンの記録はありません。</p>'}</section>`).join('')||'<p class="subtle">該当するログがありません。</p>'}</div></div></section></div>`:'<p class="subtle">公式の状態記録を再生できません。</p>'}</div>`;
}
// A full render can occur while an asynchronous request is awaiting the Worker.
// Always reconcile the live controls as well as the internal loading flag.
function updateOfficialImportState(loading, message = null) {
    officialArenaLoading = Boolean(loading);
    if (message !== null) officialArenaStatusMessage = String(message);
    const button = $('[data-act="load-official-battle"]');
    if (button) {
        button.disabled = officialArenaLoading;
        button.textContent = officialArenaLoading ? '取得中…' : '取得して表示';
        button.setAttribute('aria-busy', String(officialArenaLoading));
    }
    const input = $('#official-battle-url');
    if (input) input.disabled = officialArenaLoading;
    const status = $('#official-battle-status');
    if (status) status.textContent = officialArenaStatusMessage;
}
function installOfficialResult(next) {
    stopOfficialPlayback();
    officialArena=next;
    officialFrameIndex=next.frames?.length ? next.frames.length-1 : null;
    officialArenaTurn='all';officialLogMode='simple';
    officialArenaUrl=next.sourceUrl||'';
    try {
        const payload=JSON.stringify(next);
        if (payload.length<2500000) sessionStorage.setItem(OFFICIAL_BATTLE_STATE_KEY,payload);
        else sessionStorage.removeItem(OFFICIAL_BATTLE_STATE_KEY);
    } catch { /* Browser storage can be disabled; viewing remains possible. */ }
    render();
}
function stopOfficialPlayback() {
    if(officialPlaybackTimer!==null)clearInterval(officialPlaybackTimer);
    officialPlaybackTimer=null;officialPlaying=false;
    const button=$('#official-replay-play');
    if(button){button.textContent='▶ 再生';button.setAttribute('aria-label','公式リプレイを再生する');}
}
function paintOfficialReplay() {
    const shown=officialReplayFrame();
    if(!shown||!$('#official-replay-map'))return;
    const count=officialArena.frames.length;
    $('#official-replay-map').innerHTML=map(shown.units,true,false,false,officialMapContext(shown));
    $('#official-replay-units').innerHTML=replayUnits(shown.units, true);
    $('#official-replay-label').textContent=`T${String(shown.turn).padStart(2,'0')} / ${shown.label} （${(officialFrameIndex??count-1)+1}/${count}）`;
    $('#official-frame-range').value=String(officialFrameIndex??count-1);
    const selectedLogIndex=shown.logIndex;
    $('#official-log-list')?.querySelectorAll('[data-official-log-index]').forEach(row=>{
        const active=Number(row.dataset.officialLogIndex)===selectedLogIndex;
        row.classList.toggle('selected-log',active);
        row.setAttribute('aria-pressed',String(active));
    });
    if(expandedMapSource==='official')repaintExpandedMap();
    refreshMobileReplayMap();
    scheduleMobileReplayMapVisibility();
}
function setOfficialFrame(index,stop=true) {
    if(stop)stopOfficialPlayback();
    if(!officialArena?.frames?.length)return;
    officialFrameIndex=Math.max(0,Math.min(officialArena.frames.length-1,Math.round(Number(index)||0)));
    paintOfficialReplay();
}
function toggleOfficialPlayback() {
    if(officialPlaying){stopOfficialPlayback();return;}
    if(!officialArena?.frames?.length)return;
    if((officialFrameIndex??officialArena.frames.length-1)>=officialArena.frames.length-1)officialFrameIndex=0;
    officialPlaying=true;
    const button=$('#official-replay-play');
    if(button){button.textContent='Ⅱ 一時停止';button.setAttribute('aria-label','公式リプレイを一時停止する');}
    paintOfficialReplay();
    officialPlaybackTimer=setInterval(()=>{
        if(page!=='sim'||!$('#official-replay-map')||!officialArena){stopOfficialPlayback();return;}
        if(officialFrameIndex>=officialArena.frames.length-1){stopOfficialPlayback();return;}
        setOfficialFrame(officialFrameIndex+1,false);
        if(officialFrameIndex>=officialArena.frames.length-1)stopOfficialPlayback();
    },250);
}
function bindOfficialReplay() {
    if(!$('#official-replay-map'))return;
    paintOfficialReplay();
    const box=$('#official-log-list');
    if(!box)return;
    box.addEventListener('scroll',()=>{
        if(officialPlaying)return;
        cancelAnimationFrame(officialScrollFrame);
        officialScrollFrame=requestAnimationFrame(()=>{
            const candidates=[...box.querySelectorAll('[data-official-log-index]')].filter(row=>row.getBoundingClientRect().bottom>box.getBoundingClientRect().top+16);
            const selected=candidates[0];
            if(selected)setOfficialFrame(officialArena.logs[Number(selected.dataset.officialLogIndex)]?.replayFrame??0);
        });
    },{passive:true});
}

function challengeReactionPanel() {
    const ch=challenge();
    if(!isSeraraChallengeId(ch?.id))return '';
    const currentBattle=sim?.config?.challenge?.id===ch.id?sim:null;
    const chosen=currentBattle?seraraReactionAt(currentBattle,
        frame<0?Math.max(0,currentBattle.frames.length-1):frame,selectedLogId):
        {label:'試合開始前',text:SERARA_REACTION_LINES.start,key:'start'};
    return `<section id="serara-reaction-panel" class="serara-reaction-panel" aria-label="セララのリアクション">
        ${challengePortrait(ch,'serara-reaction-portrait')}
        <div class="serara-reaction-content"><strong>甘咲 セララ</strong>
        <p id="serara-reaction-text" class="serara-reaction-bubble">${chosen?`「${esc(chosen.text)}」`:'戦闘中のリアクションをリプレイで確認できます。'}</p></div>
    </section>`;
}
function paintChallengeReaction() {
    const text=$('#serara-reaction-text');
    if(!text||!isSeraraChallengeId(challenge()?.id))return;
    const validBattle=isSeraraChallengeId(sim?.config?.challenge?.id)?sim:null;
    const picked=validBattle?seraraReactionAt(validBattle,frame,selectedLogId):
        {label:'試合開始前',text:SERARA_REACTION_LINES.start};
    text.textContent=picked?`「${picked.text}」`:'戦闘中のリアクションをリプレイで確認できます。';
}

function battleDialoguePanel(){
    const all=sim ? buildBattleReactions(sim) : [];
    const preview=!sim ? config.units.filter(u=>!(isSeraraChallengeId(challenge()?.id) && u.team==='B') && u.reactionLines?.start?.trim())
        .map(u=>({unitName:u.name,text:u.reactionLines.start,key:'start'})) : [];
    if(!all.length && !preview.length)return '';
    const lines=sim ? battleReactionAt(sim,frame<0?Math.max(0,sim.frames.length-1):frame,selectedLogId) : preview;
    return `<section class="battle-dialogue-panel" id="battle-dialogue-panel" aria-label="キャラクターの演出セリフ"><h2>キャラクターのセリフ</h2><div id="battle-dialogue-lines">${battleDialogueMarkup(lines)}</div></section>`;
}
function battleDialogueMarkup(lines){
    return lines?.length?lines.map(e=>`<div class="battle-dialogue-line"><strong>${esc(e.unitName)}</strong><p>「${esc(e.text)}」</p></div>`).join(''):'<p class="subtle">この場面にセリフはありません。</p>';
}
function simPage() {
    const result = sim?.result();
    const stale = sim && JSON.stringify(config) !== JSON.stringify(sim.config);
    const a = config.units.filter(u => u.team === 'A').length, b = config.units.filter(u => u.team === 'B').length;
    return `<div class="sim-page-heading"><div class="sim-page-title"><h1>シミュレーション</h1><p class="subtitle">実行ごとに乱数を自動で更新します。</p></div><div class="sim-settings"><div class="sim-settings-fields">${field('乱数', select({ auto: '毎回自動（通常）', fixed: 'シード固定（再現用）' }, config.settings.seedMode, 'data-settings="seedMode"'))}${config.settings.seedMode === 'fixed' ? field('再現用シード', `<input data-settings="seed" value="${esc(config.settings.seed)}">`) : ''}${field('ターン制限', '<div class="fixed-turns">サドンデス込 25T</div>')}</div><div class="sim-settings-actions">${btn('リセット', 'reset-sim', '', !sim ? 'disabled' : '')}${btn('1ターン進める', 'step', '', busy || (sim?.done && !stale) ? 'disabled' : '')}${btn(`${icon('sim', 'inline-icon')}${sim && !sim.done ? '最後まで実行' : 'シミュレーション実行'}`, 'run', 'primary', busy ? 'disabled' : '')}</div></div></div>${stale ? '<div class="notice">設定が変更されています。表示中の結果は変更前のものです。次の実行時に初期状態から再計算します。</div>' : ''}${officialBattlePanel()}${challengeReactionPanel()}${battleDialoguePanel()}${batchPanel()}${!sim ? `<div class="result-grid">\
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
<span class="kpi-hint">クリーン・ハード・スマッシュの合計</span></div></div>${renderCombatStatistics(r.statistics,r.turns)}${tiePanel}${r.warnings.length ? `<div class="notice">${r.warnings.map(esc).join('<br>')}</div>` : ''}<div class="result-grid replay-layout">\
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
    if(!sim)return [];
    const dialogue=logSearch?battleReactionByLog(sim):null;
    const serara=logSearch && isSeraraChallengeId(sim?.config?.challenge?.id)?seraraReactionByLog(sim):null;
    return sim.logs.filter(l=>
        (logTurn==='all'||l.turn===Number(logTurn)) &&
        (logType==='all'||logType==='main'&&!['condition','actionEnd','reserve'].includes(l.type)||
         logType===l.type||logType==='damage'&&(['pursuit','suddenDamage'].includes(l.type)||l.type==='bs'&&l.message.includes('障壁が'))) &&
        (!logSearch || (
            l.message+' '+l.detail+' '+(l.tags||[]).map(t=>t.label).join(' ')
        ).includes(logSearch) || (dialogue?.get(l.id)||[]).some(e=>(e.unitName+' '+e.text).includes(logSearch)) ||
        (serara?.get(l.id)||[]).some(e=>('セララ '+e.text).includes(logSearch))));
}
function logEntries() {
    const logs = visibleLogs(), reactions = isSeraraChallengeId(challenge()?.id) && isSeraraChallengeId(sim?.config?.challenge?.id) ? seraraReactionByLog(sim) : new Map(), dialogueReactions = battleReactionByLog(sim), types = {
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
    // Display from the FIRST event forward. The previous slice(-700) hid
    // the beginning of long battles, even when the scrollbar was at the top.
    const opening = isSeraraChallengeId(sim?.config?.challenge?.id) &&
        logTurn === 'all' && ['all','main'].includes(logType) &&
        (!logSearch || (`${SERARA_REACTION_LINES.start} セララ 開始前 挨拶`).includes(logSearch))
        ? `<div class="log serara-start-log${selectedLogId===-1 && frame===0 ? ' selected-log' : ''}" role="button" tabindex="0" data-log-id="-1" data-act="select-log:-1" aria-pressed="${selectedLogId===-1 && frame===0}"><span class="time">開始前</span><span class="type">挨拶</span><div class="serara-log-reaction">${challengePortrait(challenge(),'serara-log-portrait')}<span><strong>セララ</strong>「${esc(SERARA_REACTION_LINES.start)}」</span></div></div>` : '';
    const genericGreetings=buildBattleReactions(sim).filter(e=>e.key==='start');
    const genericOpening=genericGreetings.length && logTurn==='all' && ['all','main'].includes(logType) && (!logSearch || genericGreetings.some(e=>`${e.unitName} ${e.text}`.includes(logSearch))) ? `<div class="log character-greeting-log" data-act="select-log:-1" role="button" tabindex="0" data-log-id="-1"><span class="time">開始前</span><span class="type">挨拶</span><div>${genericGreetings.filter(e=>!logSearch||`${e.unitName} ${e.text}`.includes(logSearch)).map(e=>`<div class="battle-inline-reaction"><strong>${esc(e.unitName)}</strong>「${esc(e.text)}」</div>`).join('')}</div></div>` : '';
    const shown = logs.slice(0, logVisibleCount);
    return opening + genericOpening + shown.map(l => `<div class="log ${l.type}${selectedLogId === l.id ? ' selected-log' : ''}" role="button" tabindex="0" data-log-id="${l.id}" data-act="select-log:${l.id}" aria-pressed="${selectedLogId === l.id}">\
<span class="time">T${String(l.turn).padStart(2, '0')}<span class="time-gauge">${['speed', 'sudden', 'suddenDamage'].includes(l.type) ? '開始時' : `残行動値 ${Math.floor(l.gauge)}`}</span></span>\
<span class="type">${combatLogTypeLabel(l.type, l.message) || types[l.type] || l.type}</span>\
<div>${esc(l.message)}${l.tags?.length ? `<div class="log-tags">${l.tags.map(tag => `<span class="log-tag tag-${[
        'buff',
        'splash',
        'weak',
        'status',
        'result'
    ].includes(tag.kind) ? tag.kind : 'other'}">${esc(tag.label)}</span>`).join('')}</div>` : ''}${l.detail ? `<div class="detail">${esc(l.detail)}</div>` : ''}${(reactions.get(l.id)||[]).map(r=>`<div class="serara-log-reaction">${challengePortrait(challenge(),'serara-log-portrait')}<span><strong>セララ</strong>「${esc(r.text)}」</span></div>`).join('')}${(dialogueReactions.get(l.id)||[]).map(r=>`<div class="battle-inline-reaction"><strong>${esc(r.unitName)}</strong>「${esc(r.text)}」</div>`).join('')}</div>\
</div>`).join('') + (!logs.length && !opening && !genericOpening ? '<div class="empty">一致するログがありません。</div>' : '') + (logs.length > shown.length ? `<div class="log-load-more"><button type="button" data-act="log-more">続きを表示（${shown.length.toLocaleString()} / ${logs.length.toLocaleString()}件）</button></div>` : '');
}
// 長いBS一覧でHP/APバーが縦に押し広げられないようにする。
// 通常の再生と公式戦闘の再生の両方で共通使用する。
function replayBsStatus(bs) {
    const active=(Array.isArray(bs)?bs:[]).filter(b=>b && b.remaining>0);
    if(!active.length)return '';
    if(active.length<=5)return `<div class="skill-tags">${active.map(b=>pill(bsStatusLabel(b),'gold')).join('')}</div>`;
    const grouped=new Map();
    for(const b of active){
        const label=bsStatusLabel(b);
        grouped.set(label,(grouped.get(label)||0)+1);
    }
    const tags=[...grouped].map(([label,count])=>pill(count>1?`${label} ×${count}`:label,'gold')).join('');
    const types=new Set(active.map(b=>b.name)).size;
    return `<details class="replay-bs-overflow"><summary>BS ${active.length}個（${types}種類）を表示</summary><div class="skill-tags replay-bs-overflow-list">${tags}</div></details>`;
}
function replayUnits(units, official = false) {
    return `<div class="combatants replay-teams">${groupReplayUnitsByTeam(units).map(({ team, units: members }) => `<section class="replay-team ${team === 'B' ? 'enemy' : ''}" aria-label="TEAM ${team}のユニットの状態">\
<div class="replay-team-head"><strong>TEAM ${team} <span>${team === 'A' ? '自チーム' : '相手チーム'}</span>\
</strong><small>${members.length}人</small>\
</div><div class="replay-team-members">${members.map((u, index) => `<div class="combatant">\
${unitAvatar(team, index, u)}\
<div><div class="name">${esc(u.name)} ${u.alive ? '' : pill('戦闘不能', 'red')}</div>\
<div class="numbers"><span class="replay-hp-value">HP ${u.hp==null?'—':nf(u.hp)} / ${u.maxHp==null?'—':nf(u.maxHp)} <strong class="replay-hp-percent">(${u.maxHp===0 ? '0.0' : u.hp!=null&&u.maxHp>0 ? (clamp(u.hp / u.maxHp * 100, 0, 100)).toFixed(1) : '—'}%)</strong></span>\
<span>AP ${u.ap==null?'—':nf(u.ap)}${u.maxAp==null?'':` / ${nf(u.maxAp)}`}</span>${u.barrier > 0 ? `<span class="replay-barrier">障壁 ${nf(u.barrier)}</span>` : ''}\
</div><div class="hpbar"><i style="width:${u.hp!=null&&u.maxHp>0?clamp(u.hp / u.maxHp * 100, 0, 100):0}%">\
</i></div><div class="apbar"><i style="width:${u.ap!=null&&u.maxAp>0 ? clamp(u.ap / u.maxAp * 100, 0, 100) : 0}%">\
</i></div><p class="subtle">${Number.isFinite(u.x)&&Number.isFinite(u.y)?`座標 (${u.x.toFixed(1)}, ${u.y.toFixed(1)}) m`:'座標情報なし'}</p>${replayBsStatus(u.bs)}</div>\
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
    paintChallengeReaction();
    const dialogue=$('#battle-dialogue-lines');
    if(dialogue)dialogue.innerHTML=battleDialogueMarkup(battleReactionAt(sim,frame,selectedLogId));
    $('#log-entries')?.querySelectorAll('[data-log-id]').forEach(el => {
        const active = Number(el.dataset.logId) === selectedLogId;
        el.classList.toggle('selected-log', active);
        el.setAttribute('aria-pressed', String(active));
    });
}
function selectLog(id) {
    if (Number(id) === -1 && sim && (isSeraraChallengeId(sim.config?.challenge?.id) || buildBattleReactions(sim).some(e=>e.key==='start'))) {
        selectedLogId = -1;
        frame = 0;
        persistUi();
        paintReplay();
        return;
    }
    const log = sim?.logs.find(l => l.id === Number(id));
    if (!log || !Number.isInteger(log.frameIndex))
        return;
    selectedLogId = log.id;
    frame = log.frameIndex;
    persistUi();
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
    const atBottom = box.scrollHeight > box.clientHeight + 3 && box.scrollHeight - box.clientHeight - box.scrollTop <= 3;
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
    // For a fresh run, begin at the opening log instead of jumping to the end.
    box.scrollTop = logScrollTop ?? 0;
    syncMapToVisibleLog();
    paintReplay();
    scheduleMobileReplayMapVisibility();
    box.addEventListener('scroll', () => {
        logScrollTop = box.scrollTop;
        persistUi();
        cancelAnimationFrame(logScrollFrame);
        logScrollFrame = requestAnimationFrame(syncMapToVisibleLog);
    }, { passive: true });
}
function refreshLogList() {
    logVisibleCount = LOG_RENDER_BATCH;
    persistUi();
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
    if (challenge() && id && config.units.some(v=>v.team==='B'&&v.skills.includes(id)) && !current().skills.includes(id) && !id.startsWith('wiki-')) {challengeInvalidMove('チャレンジ専用スキルの詳細・編集はできません。');return;}
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
function unitConditionalPassiveEditor() {
    const passives = modalDraft?.conditionalPassives || [];
    const presetItems = [
        '<option value="">スキルを選択</option>',
        ...CONDITIONAL_PASSIVE_TEMPLATES.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`),
        '<optgroup label="数値を手動設定">',
        ...Object.entries(CONDITIONAL_KIND_OPTIONS).map(([k,v]) => `<option value="custom-${k}">自由設定：${esc(v.split('（')[0])}</option>`),
        '</optgroup>'
    ].join('');
    const statOptions = Object.entries(STAT_LABELS);
    const effectOptions = Object.entries(EFFECTS).filter(([k]) => CONDITIONAL_SUPPORTED_EFFECT_KEYS.includes(k));
    const modifierEditor = (index, group, options, title, fixed) => {
        const mod = passives[index]?.[group] || {};
        const names = Object.fromEntries(options);
        if (fixed) {
            const values = Object.entries(mod).map(([key,val]) => `<span class="passive-editor-static-item">${esc(names[key] || key)} <strong>${Number(val)>=0 ? '+' : ''}${esc(val)}</strong></span>`).join('');
            return `<div class="passive-editor-mods"><div class="passive-editor-group-heading">${esc(title)}</div>
                <div class="passive-editor-static-values">${values || '<span class="subtle">なし</span>'}</div></div>`;
        }
        const rows = Object.entries(mod).map(([key,val]) => `<div class="passive-editor-mod-row">
            <select data-passive-mod-key="${index}:${group}:${esc(key)}" aria-label="${esc(title)}の種類">${options.map(([k,label]) => `<option value="${esc(k)}" ${k===key?'selected':''}>${esc(label)}</option>`).join('')}</select>
            <input type="number" step="any" data-passive-mod="${index}:${group}:${esc(key)}" value="${esc(val)}" aria-label="${esc(title)}の補正値">
            ${btn('削除',`remove-passive-mod:${index}:${group}:${key}`,'small danger')}</div>`).join('');
        return `<div class="passive-editor-mods"><div class="passive-editor-group-heading">${esc(title)}</div>${rows}${options.some(([k])=>!Object.hasOwn(mod,k)) ? btn('＋ 追加',`add-passive-mod:${index}:${group}`,'small ghost'):''}</div>`;
    };
    return `<section class="passive-editor-section"><div class="field-section">条件付きパッシブ</div>
        <p class="subtle">名前付きスキルは固定値です。数値を変えたい場合は自由設定を使用してください。 <a href="https://c01301.sakura.ne.jp/rev2_wiki/doku.php?id=%E3%83%91%E3%83%83%E3%82%B7%E3%83%96" rel="noreferrer">パッシブ一覧</a></p>
        <div class="passive-preset-picker"><select id="unit-passive-template" aria-label="追加する条件付きパッシブ">${presetItems}</select>${btn('＋ パッシブを追加','add-unit-passive','small primary')}</div>
        ${passives.length ? passives.map((p,index) => {
            const fixed = isFixedConditionalPassive(p);
            return `<div class="passive-editor-card">
            <div class="passive-editor-heading"><strong>${esc(p.name)}</strong>${btn('削除',`remove-draft-passive:${index}`,'small danger')}</div>
            <div class="passive-editor-meta">${fixed ? '<span class="passive-baseline-label">規定値・編集不可</span>' : `<label>名前<input type="text" maxlength="200" data-passive-name="${index}" value="${esc(p.name)}"></label>`}
            ${['accel','timed'].includes(p.kind) ? (fixed ? `<span class="passive-baseline-label">${p.kind === 'accel' ? '加速' : '時限'}${esc(p.interval)}</span>` : `<label>発動間隔・期限<input type="number" min="1" max="${p.kind==='accel'?20:9999}" step="1" data-passive-interval="${index}" value="${esc(p.interval)}"></label>`) : ''}
            <span class="passive-baseline-label">${p.baselineIncluded === false ? '手動追加' : '公式取得'}</span></div>
            ${p.note ? `<small class="subtle">${esc(p.note)}</small>` : ''}
            ${modifierEditor(index,'modifiers',statOptions,'能力補正',fixed)}
            ${modifierEditor(index,'effects',effectOptions,'その他のステータス補正',fixed)}
        </div>`;}).join('') : '<p class="subtle">条件付きパッシブはありません。</p>'}
    </section>`;
}
function syncUnitPassiveEditor() {
    const items = modalDraft?.conditionalPassives;
    if (!Array.isArray(items)) return;
    document.querySelectorAll('#modal [data-passive-name]').forEach(el => {const p=items[Number(el.dataset.passiveName)]; if(p && !isFixedConditionalPassive(p)) p.name=el.value.trim();});
    document.querySelectorAll('#modal [data-passive-interval]').forEach(el => {const p=items[Number(el.dataset.passiveInterval)]; if(p && !isFixedConditionalPassive(p)) p.interval=Number(el.value);});
    document.querySelectorAll('#modal [data-passive-mod]').forEach(el => {
        const [index,group,key]=el.dataset.passiveMod.split(':');
        const p=items[Number(index)]; if(p && !isFixedConditionalPassive(p) && p[group]) p[group][key]=el.value===''?NaN:Number(el.value);
    });
}
function renderModal() {
    if (modalMode === 'unit') {
        $('#modal').innerHTML = `<div class="modal-header"><h2>${esc(current().name)}の固有効果</h2>${btn('×', 'close-modal', 'ghost')}</div>\
<div class="modal-form"><p class="subtle">数値を使わない効果は、選択するだけで有効になります。</p>${effectEditor('effects', EFFECTS, '固有の特殊効果')}${unitConditionalPassiveEditor()}</div>\
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
   ${attacking ? `<details class="accordion ak-bs-picker"><summary>命中時に与えるBS <span class="bs-count" data-draft-bs-count>（${(s.bs || []).length}種類）</span></summary><div class="normal-bs-checks">${BS_NAMES.map(b => `<label class="normal-bs-check"><input type="checkbox" value="${esc(b)}" data-draft-bs ${(s.bs || []).includes(b) ? 'checked' : ''}><span>${esc(b)}</span></label>`).join('')}</div><p class="footnote">チェックしたBSを命中時に付与判定します（基本3ターン）。複数選択でき、もう一度押すと解除できます。</p></details>` : ''}
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
    if (modalMode === 'unit') syncUnitPassiveEditor();
    // AKのBSは通常攻撃と同じチェックボックス式。装備・保存の形式（bs配列）は従来どおり。
    const bsPanel = $('#modal').querySelector('.ak-bs-picker');
    if (bsPanel)
        modalDraft.bs = [...bsPanel.querySelectorAll('[data-draft-bs]:checked')].map(box => box.value);
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
    if (!challengePartyValid(config))errors.push('チャレンジの参加人数またはチームBの構成が不正です。');
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
        const fresh = !sim || sim.done || JSON.stringify(config) !== JSON.stringify(sim.config);
        if (fresh)
            sim = new Battle(config);
        if (full)
            sim.run();
        else
            sim.stepTurn();
        if (full || fresh) {
            // Both full runs and newly started step-by-step runs open at T01.
            frame = 0;
            selectedLogId = -1;
            logScrollTop = 0;
            logVisibleCount = LOG_RENDER_BATCH;
        }
        // Continuing a stepped battle keeps the user's current reading position.
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
    worker = new Worker('./worker.js?v=1.18.21&dialogueui=1', { type: 'module' });
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
function exportStatus(message, error = false) {
    const node = $('#share-export-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', error);
}
function openShareExportDialog(unit) {
    shareExportTargetId = unit.id;
    const dialog = $('#arena-share-export-dialog');
    if (!dialog) return;
    $('#share-export-unit').textContent = unit.name;
    $('#share-export-list').innerHTML = unit.rules.map((rule, index) => {
        const text = ACTIONS[rule.action] || rule.action;
        return `<label class="share-export-option"><input type="checkbox" data-share-export-index="${index}" ${rule.enabled ? 'checked' : ''}><span>${index + 1}. ${esc(text)}${rule.enabled ? '' : '（無効）'}</span></label>`;
    }).join('');
    const result = $('#share-export-result');
    if (result) result.hidden = true;
    exportStatus('発行するルールを選択してください。無効のルールは初期状態では選択されません。');
    dialog.showModal();
}
async function issueShareCode() {
    if (shareExportBusy) return;
    const unit = config.units.find(u => u.id === shareExportTargetId);
    if (!unit) return exportStatus('発行元のキャラクターが見つかりません。',true);
    const selectedIndices = [...document.querySelectorAll('#share-export-list [data-share-export-index]:checked')]
        .map(input => Number(input.dataset.shareExportIndex));
    let actions;
    try {
        actions = buildOfficialArenaActions(config, unit.id, selectedIndices);
        if (!ARENA_SHARED_WORKER_URL) throw Error('共有AIの発行先が未設定です。');
    } catch(error) { return exportStatus(error.message,true); }
    if (!await confirmInApp(`${actions.length}件の戦術を公式アリーナへ登録して共有コードを発行します。
発行後のコードは他の人も利用できます。続行しますか？`)) return;
    const button = $('#share-export-submit'), result = $('#share-export-result');
    shareExportBusy = true;
    if (button) button.disabled = true;
    if (result) result.hidden = true;
    exportStatus('公式アリーナで共有コードを発行しています…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
        const code = await issueArenaShareCodeViaWorker(actions, {
            workerUrl: ARENA_SHARED_WORKER_URL, signal: controller.signal
        });
        if (!$('#arena-share-export-dialog')?.open) return;
        const field = $('#share-export-code');
        if (field) field.value = code;
        if (result) result.hidden = false;
        exportStatus(`${actions.length}件のAIを共有コードとして発行しました。`);
    } catch(error) { exportStatus(error.message || '共有コードを発行できませんでした。',true); }
    finally {
        clearTimeout(timeout);
        shareExportBusy = false;
        if (button) button.disabled = false;
    }
}
async function copyIssuedCode() {
    const input = $('#share-export-code');
    if (!input?.value) return;
    try {
        await navigator.clipboard.writeText(input.value);
        exportStatus('共有コードをコピーしました。');
    } catch {
        input.focus(); input.select();
        exportStatus('コードを選択しました。手動でコピーしてください。');
    }
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
    $('#share-import-unit').textContent = unit.name;
    shareStatus('公式アリーナで発行された共有コードを入力してください。');
    dialog.showModal();
    code?.focus();
}
function closeShareDialog() {
    shareImportActions = null;
    $('#arena-share-dialog')?.close();
}
async function searchShareCode() {
    if (shareImportBusy) return;
    const code = $('#share-import-code')?.value;
    try {
        validateArenaShareCode(code);
        if (!ARENA_SHARED_WORKER_URL) {
            throw Error('運営者の共有AI取得先が未設定です。arena-worker-config.js を確認してください。');
        }
        shareImportBusy = true;
        const button = $('#share-import-search');
        if (button) button.disabled = true;
        shareStatus('公式アリーナから共有AIを取得しています…');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
            const actions = await fetchArenaSharedAiViaWorker(code, {
                workerUrl: ARENA_SHARED_WORKER_URL, signal: controller.signal
            });
            if (!$('#arena-share-dialog')?.open) return;
            showSharePreview(actions);
            shareStatus('共有AIを取得しました。内容を確認して取り込んでください。');
        } finally { clearTimeout(timeout); }
    } catch (error) {
        shareImportActions = null;
        const preview = $('#share-import-preview');
        if (preview) preview.hidden = true;
        shareStatus(error.message || '共有AIの取得に失敗しました。', true);
    } finally {
        shareImportBusy = false;
        const button = $('#share-import-search');
        if (button) button.disabled = false;
    }
}

async function applyShareResponse() {
    if (!shareImportActions || !shareImportTargetId) return;
    try {
        const target = config.units.find(u => u.id === shareImportTargetId);
        if (!target) throw Error('読み込み先が存在しません。');
        const mode = $('#share-import-mode')?.value || 'replace';
        const result = convertArenaSharedActions(shareImportActions, config, target.id, {mode});
        const summary = `「${target.name}」のAIに${result.ruleCount}件を${mode === 'replace' ? '置き換え' : '追加'}ます。\n未解決の指定スキル：${result.unresolvedSkills}件\n無効のルール：${result.disabledCount}件\n能力値・装備スキル・他キャラの設定は変更しません。\n\n続行しますか？`;
        if (!await confirmInApp(summary)) return;
        config = result.config;
        arenaImportReport = {unitId: target.id, ruleCount: result.ruleCount, warnings: result.warnings};
        selected = target.id; page = 'rules';
        sim = null; batch = null; frame = -1; selectedLogId = -1; errors = [];
        save(); render();
        closeShareDialog();
        toast(`${result.ruleCount}件の共有AIを取り込みました。${result.disabledCount ? `確認が必要な${result.disabledCount}件は無効です。` : ''}`);
    } catch(error) { shareStatus(error.message, true); }
}
async function onAction(act) {
    const [a, arg, arg2] = act.split(':');
    const u = current();
    if (a === 'ai-tab') {
        if(['rules','reactions'].includes(arg)){aiSubTab=arg;render();}
        return;
    }
    if (a === 'remove-reaction') {
        if (!REACTION_DEFINITIONS.some(d=>d.key===arg))return;
        editableReactionKeys(u).delete(arg);
        if (u.reactionLines && Object.hasOwn(u.reactionLines,arg)) {
            const values={...u.reactionLines};delete values[arg];u.reactionLines=values;save();
        }
        render();return;
    }
    if (a === 'open-challenges') {
        const choices=CHALLENGES.map(c=>`<section class="challenge-option">${challengePortrait(c, 'challenge-option-portrait')}<div class="challenge-option-details"><h3>${esc(c.title)} <span class="challenge-level">${esc(c.difficulty)}</span></h3><p>参加上限：チームA ${c.teamALimit}人 ／ 敵：${esc(c.enemyName)}</p><p>敵の能力値・AI設定は公開されず、変更もできません。</p></div>${btn(challenge()?.id===c.id?'挑戦中':'チャレンジ開始',`challenge-start:${c.id}`,'primary',challenge()?'disabled':'')}</section>`).join('');
        $('#modal').innerHTML=`<div class="modal-header"><div><div class="eyebrow">CHALLENGE CONTENTS</div><h2>チャレンジ</h2></div>${btn('×','close-modal','ghost')}</div><div class="challenge-list">${choices}</div><div class="modal-footer">${challenge()?btn('通常編成に戻す','challenge-end','small'):''}${btn('閉じる','close-modal','small')}</div>`;
        $('#modal').showModal();return;
    }
    if (a === 'challenge-start') {
        const picked=CHALLENGES.find(c=>c.id===arg);
        if (!picked || challenge()) return;
        const keepA=config.units.filter(x=>x.team==='A');
        if (keepA.length>picked.teamALimit && !await confirmInApp(`このチャレンジは${picked.teamALimit}人までです。選択中のキャラを残して参加し、その他の編成は一時保存しますか？`))return;
        try {
            const result=startChallenge(config,arg,current().id);
            config=result.config;selected=result.selectedId;page='setup';sim=null;batch=null;frame=-1;selectedLogId=-1;errors=[];
            $('#modal')?.close();save();render();toast(`${result.challenge.title}（${result.challenge.difficulty}）を開始しました。`);
        } catch(e) {toast('チャレンジを開始できません：'+e.message);}
        return;
    }
    if (a === 'challenge-end') {
        if (!challenge())return;
        if (!await confirmInApp('チャレンジを終了し、選択前の通常編成を復元しますか？'))return;
        try {
            config=endChallenge(config);selected=config.units[0].id;page='setup';sim=null;batch=null;frame=-1;selectedLogId=-1;errors=[];
            $('#modal')?.close();save();render();toast('通常編成に戻しました。');
        }catch(e){toast(e.message);}
        return;
    }
    // Defense in depth: clicking a stale/forged action must not edit the boss.
    if (challenge() && !allowUnit(u)) {challengeInvalidMove();return;}
    if (a === 'jump-slots') {
        page = 'setup'; slotsExpanded = true;
        render();
        document.getElementById('character-slots-panel')?.scrollIntoView({behavior:'smooth', block:'start'});
        return;
    }
    if (a === 'slot-save') {
        const index = Number(arg);
        if (!Number.isInteger(index) || index < 0 || index >= CHARACTER_SLOT_COUNT) return;
        const existing = readCharacterSlots(localStorage)[index];
        if (existing && !await confirmInApp(`スロット${index + 1}の保存内容を「${u.name}」で上書きしますか？`)) return;
        try {
            saveCharacterSlot(localStorage,index,config,u.id);
            slotsExpanded = true;
            render(); toast(`スロット${index + 1}に「${u.name}」を保存しました。`);
        } catch (e) { toast(e.message || 'スロットに保存できません。'); }
        return;
    }
    if (a === 'slot-clear') {
        const index = Number(arg);
        if (!Number.isInteger(index) || index < 0 || index >= CHARACTER_SLOT_COUNT) return;
        const existing = readCharacterSlots(localStorage)[index];
        if (!existing || !await confirmInApp(`スロット${index + 1}「${existing.name}」を空にしますか？`)) return;
        try {
            clearCharacterSlot(localStorage,index); slotsExpanded = true;
            render(); toast(`スロット${index + 1}を空にしました。`);
        } catch (e) { toast(e.message || 'スロットを削除できません。'); }
        return;
    }
    if (a === 'slot-load') {
        const index = Number(arg), team = arg2;
        if (!Number.isInteger(index) || index < 0 || index >= CHARACTER_SLOT_COUNT || !['A','B'].includes(team)) return;
        if (challenge() && (team!=='A'||config.units.filter(x=>x.team==='A').length>=challenge().teamALimit)) {challengeInvalidMove('チャレンジではチームAの参加人数が上限です。');return;}
        try {
            const restored = loadCharacterSlot(localStorage,index,config,team);
            config = restored.config; selected = restored.unitId;
            sim = null; batch = null; frame = -1; selectedLogId = -1; errors = [];
            slotsExpanded = true; page = 'setup';
            save(); render();
            toast(`チーム${team}へ「${restored.unitName}」を復元しました（スキル${restored.skillCount}種・AI${restored.ruleCount}件）。`);
            if (restored.warnings.length) toast(`一部のAI参照先が存在せず、${restored.warnings.length}件の確認が必要です。`);
        } catch (e) { toast(e.message || 'スロットを読み込めません。'); }
        return;
    }
    if (a === 'jump-data') {
        page = 'setup';
        render();
        document.querySelector('#data-management-panel')?.scrollIntoView?.({behavior:'smooth',block:'start'});
        return;
    }
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
    if (a === 'official-map-expand') {
        openExpandedMap('official');
        return;
    }
    if (a === 'map-expand') {
        openExpandedMap('local');
        return;
    }
    if (a === 'map-dialog-close') {
        $('#map-dialog')?.close();
        return;
    }
    if (a === 'official-replay-play') {toggleOfficialPlayback();return;}
    if (a === 'official-replay-first') {setOfficialFrame(0);return;}
    if (a === 'official-replay-last') {setOfficialFrame(officialArena?.frames?.length-1);return;}
    if (a === 'official-select-log') {
        const log=officialArena?.logs?.[Number(arg)];
        if(log)setOfficialFrame(log.replayFrame??0);
        return;
    }
    if (a === 'select-log') {
        selectLog(Number(arg));
        return;
    }
    if (a === 'log-more') {
        const box=$('#log-entries');
        if(!box || !sim)return;
        logScrollTop=box.scrollTop;
        logVisibleCount+=LOG_RENDER_BATCH;
        render();
        return;
    }
    if (a === 'load-official-battle') {
        if (officialArenaLoading) return;
        stopOfficialPlayback();
        const input = $('#official-battle-url');
        const url = input?.value?.trim() || '';
        officialArenaUrl = url;
        updateOfficialImportState(true, '公式ログを取得しています…');
        try {
            const next = await loadOfficialArenaViaWorker(url, ARENA_SHARED_WORKER_URL);
            // installOfficialResult() redraws the entire page: clear the flag
            // BEFORE redraw, not after it, or its new button stays disabled.
            officialArenaLoading = false;
            officialArenaStatusMessage = '公式ログを取得しました。ローカルのシミュレーション結果には影響しません。';
            installOfficialResult(next);
            toast('公開公式ログを読み込みました。');
        } catch (error) {
            officialArenaStatusMessage = error?.message || '公式ログの取得に失敗しました。';
        } finally {
            // Works on success, API errors, timeout and intervening page redraws.
            updateOfficialImportState(false);
        }
        return;
    }
    if (a === 'import-official-json') {
        $('#official-result-json-import')?.click();
        return;
    }
    if (a === 'clear-official-battle') {
        stopOfficialPlayback();
        officialFrameIndex=null;officialArena=null;officialArenaTurn='all';officialLogMode='simple';officialArenaUrl='';officialArenaStatusMessage='';
        try { sessionStorage.removeItem(OFFICIAL_BATTLE_STATE_KEY); } catch { /* ignore */ }
        render();return;
    }
    if (a === 'character-import') {
        openCharacterImport();
        return;
    }
    if (a === 'export-reaction-json') {
        try {
            if (!allowUnit(u)) { challengeInvalidMove(); return; }
            const name = (u.name || 'character').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0,60) || 'character';
            download(`${name}-セリフ.json`, exportReactionJson(u));
            toast(`${u.name}のセリフ設定を書き出しました。`);
        } catch (err) { toast('セリフを書き出せません：' + err.message); }
        return;
    }
    if (a === 'import-reaction-json') {
        if (!allowUnit(u)) { challengeInvalidMove(); return; }
        reactionJsonImportTarget = u.id;
        $('#reaction-json-import').click();
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
    if (a === 'open-share-export') {
        openShareExportDialog(u);
        return;
    }
    if (a === 'issue-share-code') {
        await issueShareCode();
        return;
    }
    if (a === 'copy-issued-code') {
        await copyIssuedCode();
        return;
    }
    if (a === 'close-share-export') {
        $('#arena-share-export-dialog')?.close();
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
    if (a === 'apply-share-code') {
        applyShareResponse();
        return;
    }
    if (a === 'close-share-code') {
        closeShareDialog();
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
    if (a === 'page-help') {
        openPageHelp(page);
        return;
    }
    if (a === 'guide-topic') {
        const guide=PAGE_GUIDES[page];
        if (!guide?.topics.some(t=>t.id===arg)) return;
        guideTopicId=arg;
        renderPageHelp(page);
        document.querySelector('#guide-article')?.focus({preventScroll:true});
        return;
    }
    if (a === 'page') {
        page = arg;
        errors = [];
        window.scrollTo(0, 0);
        render();
        return;
    }
    if (a === 'unit') {
        if (!allowUnit(config.units.find(v=>v.id===arg))) {challengeInvalidMove();return;}
        selected = arg;
        render();
        return;
    }
    if (a === 'close-modal') {
        $('#modal').classList.remove('manual-dialog');
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
    if (a === 'remove-unit-effect') {
        if (!Object.hasOwn(EFFECTS, arg)) return;
        if (!await confirmInApp(`特殊効果「${EFFECTS[arg]}」を削除しますか？`)) return;
        delete u.effects[arg];
        save(); render();
        return;
    }
    if (a === 'remove-unit-passive') {
        const i = Number(arg), p = u.conditionalPassives?.[i];
        if (!Number.isInteger(i) || !p) return;
        if (!await confirmInApp(`条件付きパッシブ「${p.name}」を削除しますか？`)) return;
        const next = clone(u.conditionalPassives); next.splice(i,1);
        Object.assign(u,applyPassiveEditor(u,next));
        save(); render();
        return;
    }
    if (a === 'add-unit-passive' && modalMode === 'unit') {
        syncDraft();
        const id = $('#unit-passive-template')?.value;
        if (!id) { toast('スキルまたは自由設定を選択してください。');return; }
        if (modalDraft.conditionalPassives.length >= 50) { toast('条件付きパッシブは50件までです。');return; }
        try {
            modalDraft.conditionalPassives.push(id.startsWith('custom-') ? makeCustomPassive(id.slice(7)) : makePresetPassive(id));
            renderModal();
        } catch (err) { toast(err.message); }
        return;
    }
    if (a === 'remove-draft-passive' && modalMode === 'unit') {
        syncDraft();
        const index = Number(arg);
        if (Number.isInteger(index) && index >= 0 && index < modalDraft.conditionalPassives.length)
            modalDraft.conditionalPassives.splice(index, 1);
        renderModal(); return;
    }
    if ((a === 'add-passive-mod' || a === 'remove-passive-mod') && modalMode === 'unit') {
        syncDraft();
        const index=Number(arg), item=modalDraft.conditionalPassives?.[index];
        const group=arg2;
        if (!item || isFixedConditionalPassive(item) || !['modifiers','effects'].includes(group)) return;
        if (a === 'add-passive-mod') {
            const labels=group==='modifiers'?STAT_LABELS:EFFECTS;
            const key=Object.keys(labels).find(k=>!Object.hasOwn(item[group]||{},k));
            if (key) (item[group]??={})[key]=1;
        } else {
            // action string includes the key as the fourth colon field
            const key=act.split(':')[3];
            if (key) delete item[group][key];
        }
        renderModal();return;
    }
    if (a === 'unit-effects') {
        modalMode = 'unit';
        modalDraft = { effects: clone(u.effects || {}), conditionalPassives: clone(u.conditionalPassives || []) };
        renderModal();
        $('#modal').showModal();
        return;
    }
    if (a === 'save-unit-effects') {
        syncDraft();
        if (!validConditionalPassives(modalDraft.conditionalPassives)) {
            toast('条件付きパッシブの数値・名前・補正・間隔を確認してください。'); return;
        }
        const effects = clone(modalDraft.effects);
        for (const key of Object.keys(effects)) if (FLAG_EFFECTS.has(key)) effects[key] = 1;
        const updated=applyPassiveEditor(u, modalDraft.conditionalPassives, effects);
        if (updated.maxHp < 1 || updated.maxAp < 0) {
            toast('編集後のHP・APを確認してください。');return;
        }
        Object.assign(u,updated);
        $('#modal').close();
        save(); render();
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
        if (!await confirmInApp(notice))
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
        if (challenge() && (arg!=='A'||config.units.filter(x=>x.team==='A').length>=challenge().teamALimit)) {challengeInvalidMove('チャレンジの参加人数が上限です。');return;}
        if (config.units.length >= 16) {
            toast('ユニットは最大16人です。');
            return;
        }
        const v = freshUnit({
            name: allocateDefaultUnitName(config, arg),
            team: arg,
            x: arg === 'A' ? -10 : 10,
            y: 0
        });
        config.units.push(v);
        arrangeInitialPositions(config.units);
        selected = v.id;
    }
    else if (a === 'clone-unit') {
        if (challenge() && config.units.filter(x=>x.team==='A').length>=challenge().teamALimit) {challengeInvalidMove('チャレンジの参加人数が上限です。');return;}
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
        if (challenge() && u.team==='B') {challengeInvalidMove();return;}
        if (config.units.filter(v => v.team === u.team).length <= 1) {
            toast('各チームに1人以上必要です。');
            return;
        }
        const result = deleteUnitSafely(config, u.id);
        selected = result.nextSelected;
        if (!['all', 'selected'].includes(mapFocus) && !config.units.some(v => v.id === mapFocus)) mapFocus = 'selected';
        sim = null; batch = null; frame = -1; selectedLogId = -1; errors = [];
        if (result.disabledRules) toast(`参照先が削除されたAI ${result.disabledRules}件を無効にしました。`);
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
        if (challenge()) {toast('チャレンジでは敵の設定が含まれる戦闘結果JSONを出力できません。');return;}
        download('arcadia-battle-result.json', { ...sim.result(), config: sim.config });
        return;
    }
    else if (a === 'export-log') {
        const reactions=isSeraraChallengeId(challenge()?.id) && isSeraraChallengeId(sim?.config?.challenge?.id) ? seraraReactionByLog(sim) : new Map();
        const greeting=reactions.size||isSeraraChallengeId(sim?.config?.challenge?.id) ? `【セララ】「${SERARA_REACTION_LINES.start}」\n` : '';
        const general=battleReactionByLog(sim);
        const otherGreetings=buildBattleReactions(sim).filter(e=>e.key==='start').map(e=>`【${e.unitName}】「${e.text}」`).join('\n');
        const openingDialogue=otherGreetings ? otherGreetings+'\n' : '';
        download('arcadia-battle-log.txt', `ロスアカ Battle Lab / seed: ${sim.seed}\n\n` + greeting + openingDialogue + sim.logs.map(l => `[T${String(l.turn).padStart(2, '0')} / ${['speed', 'sudden', 'suddenDamage'].includes(l.type) ? '開始時' : `残行動値 ${Math.floor(l.gauge)}`}] ${l.message}${l.tags?.length ? '\n  【効果】' + l.tags.map(t => t.label).join(' / ') : ''}${l.detail ? '\n  ' + l.detail : ''}${(reactions.get(l.id)||[]).map(r=>`\n  【セララ】「${r.text}」`).join('')}${(general.get(l.id)||[]).map(r=>`\n  【${r.unitName}】「${r.text}」`).join('')}`).join('\n'), 'text/plain');
        return;
    }
    else if (a === 'reset-config') {
        if (challenge()) {challengeInvalidMove('チャレンジを終了してから編成を初期化してください。');return;}
        if (!await confirmInApp('現在の設定を初期編成に戻します。必要なら先に設定を書き出してください。'))
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
document.addEventListener('toggle', e => {
    if (e.target?.id === 'character-slots-panel') slotsExpanded = e.target.open;
}, true);
document.addEventListener('change', e => {
    const el = e.target, u = current();
    if (el.matches('[data-add-reaction]')) {
        const key=el.value;
        if (!REACTION_DEFINITIONS.some(d=>d.key===key))return;
        const selected=editableReactionKeys(u);
        if (selected.has(key))return;
        selected.add(key);render();
        document.querySelector(`[data-reaction-key="${key}"]`)?.focus();
        return;
    }
    if (el.matches('[data-reaction-key]')) {
        const key=el.dataset.reactionKey;
        if (!REACTION_DEFINITIONS.some(d=>d.key===key))return;
        const next={...(u.reactionLines||{})};
        if (el.value.length > MAX_REACTION_LENGTH) el.value=el.value.slice(0,MAX_REACTION_LENGTH);
        if(el.value.trim())next[key]=el.value;else delete next[key];
        u.reactionLines=next;save();return;
    }
    if (el.matches('[data-guide-topic-select]')) {
        if (!PAGE_GUIDES[page]?.topics.some(t=>t.id===el.value)) return;
        guideTopicId=el.value; renderPageHelp(page); return;
    }
    if (el.matches('[data-character-slot-select]')) {
        const n=Number(el.value);
        if (!Number.isInteger(n) || n<0 || n>=CHARACTER_SLOT_COUNT) return;
        selectedSlotIndex=n; slotsExpanded=true; render(); return;
    }
    if (el.matches('[data-slot-unit-select]')) {
        if (config.units.some(item=>item.id===el.value && allowUnit(item))) {
            selected=el.value; slotsExpanded=true; render();
        }
        return;
    }
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
    if (el.matches('[data-passive-preview-turn]')) {
        const n = Number(el.value);
        if (Number.isInteger(n) && n >= 0 && n <= 20) passivePreviewTurn = n;
        render(); return;
    }
    if (el.matches('[data-passive-preview-hp]')) {
        passivePreviewHp = el.value;
        render(); return;
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
        if (!allowUnit(u) || challenge() && el.dataset.unit==='team') {challengeInvalidMove();render();return;}
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
    if (el.matches('[data-draft-bs]') && modalMode === 'skill' && modalDraft) {
        const bsPanel = $('#modal').querySelector('.ak-bs-picker');
        if (!bsPanel) return;
        modalDraft.bs = [...bsPanel.querySelectorAll('[data-draft-bs]:checked')].map(box => box.value);
        const count = bsPanel.querySelector('[data-draft-bs-count]');
        if (count) count.textContent = `（${modalDraft.bs.length}種類）`;
        return;
    }
    if (el.matches('[data-unit-normal-bs]')) {
        u.normalBS = [...document.querySelectorAll('[data-unit-normal-bs]:checked')].map(box => box.value);
        const count = document.querySelector('[data-normal-bs-count]');
        if (count) count.textContent = `（${u.normalBS.length}種類）`;
        save();
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
        if (!allowUnit(config.units.find(v=>v.id===el.value))) {challengeInvalidMove();render();return;}
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
    if (el.id === 'official-log-mode') {
        stopOfficialPlayback();
        officialLogMode = el.value === 'all' ? 'all' : 'simple';
        render();return;
    }
    if (el.id === 'official-battle-turn') {
        stopOfficialPlayback();
        officialArenaTurn = el.value;
        if(officialArena?.frames?.length) {
            const target=el.value==='all'?officialArena.lastTurn:Number(el.value);
            const last=officialArena.frames.findLastIndex(f=>f.turn<=target);
            officialFrameIndex=last>=0?last:0;
        }
        const panel = document.querySelector('.official-battle-panel');
        if (panel) {
            const keep = $('#official-battle-url')?.value;
            if (keep) officialArenaUrl=keep;
        }
        render();return;
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
    if (el.matches('[data-passive-mod-key]') && modalMode === 'unit') {
        syncDraft();
        const [index,group,old]=el.dataset.passiveModKey.split(':');
        const item=modalDraft.conditionalPassives?.[Number(index)];
        if (!item || isFixedConditionalPassive(item) || !['modifiers','effects'].includes(group) || !item[group]) return;
        const labels=group==='modifiers'?STAT_LABELS:EFFECTS;
        if (!Object.hasOwn(labels,el.value) || (el.value!==old && Object.hasOwn(item[group],el.value))) {
            toast('同じ能力補正は1件だけ設定できます。');renderModal();return;
        }
        const value=item[group][old];delete item[group][old];item[group][el.value]=value;
        renderModal();return;
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
    if (el.matches('[data-reaction-key]')) {
        const unit=current(),key=el.dataset.reactionKey;
        if(!REACTION_DEFINITIONS.some(d=>d.key===key))return;
        const next={...(unit.reactionLines||{})};
        if (el.value.length > MAX_REACTION_LENGTH) el.value=el.value.slice(0,MAX_REACTION_LENGTH);
        if(el.value.trim())next[key]=el.value;else delete next[key];
        unit.reactionLines=next;save();return;
    }
    if (el.id === 'official-frame-range') {
        setOfficialFrame(el.value);return;
    }
    if (el.id === 'frame-range') {
        frame = Number(el.value);
        selectedLogId = -1;
        persistUi();
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
$('#official-result-json-import').addEventListener('change', async e => {
    const file=e.target.files?.[0];
    if (!file) return;
    try {
        if (file.size>5000000) throw Error('公式ログのJSONは5MB以下にしてください。');
        const raw=JSON.parse(await file.text());
        const next=parseOfficialArenaResult(raw);
        // The file remains local; raw JSON and its possible unrelated fields
        // are never sent to the Worker or stored in the session.
        const candidate=($('#official-battle-url')?.value||'').trim();
        if (candidate) {
            try {
                const location=officialArenaResultLocation(candidate);
                if (location.battleId===next.id) {
                    next.sourceUrl=location.url;
                    next.resultKind=location.kind;
                }
            } catch { /* No trusted URL: do not invent a source link. */ }
        }
        officialArenaStatusMessage = '公式ログJSONを取り込みました。';
        installOfficialResult(next);
        toast('保存された公式ログJSONを取り込みました。');
    } catch (error) {
        toast('公式ログJSONを読み込めません：'+(error?.message||'ファイル形式を確認してください。'));
    } finally {e.target.value='';}
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
        if (!allowUnit(target)) throw Error('チャレンジの敵キャラクターは変更できません。');
        const result = importUnitCharacter(config, targetId, payload);
        if (!await confirmInApp(`選択中の「${target.name}」を「${result.name}」の設定で置き換えます。\n能力値・固有効果・開始時BS・装備スキル・AIを読み込みます。\nチーム・初期座標と他のキャラクターは変更しません。\n続行しますか？`)) return;
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
$('#reaction-json-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0], targetId = reactionJsonImportTarget;
    reactionJsonImportTarget = null;
    if (!f) return;
    try {
        if (f.size > 300000) throw Error('セリフJSONは300KB以下にしてください。');
        const payload = JSON.parse(await f.text());
        const loaded = readReactionJson(payload);
        const target = config.units.find(unit => unit.id === targetId);
        if (!target || !allowUnit(target)) throw Error('読み込み先のキャラクターを編集できません。');
        if (!await confirmInApp(`「${target.name}」のセリフ設定のみをJSONの内容で置き換えます。\n能力値・装備スキル・行動ルールは変更しません。\n続行しますか？`)) return;
        target.reactionLines = loaded.lines;
        reactionEditorSelections.delete(target);
        sim = null; batch = null; frame = -1; selectedLogId = -1; errors = [];
        save(); render();
        toast(`セリフ設定を読み込みました。${loaded.adjusted ? '80文字を超える台詞は短縮しました。' : ''}`);
    } catch (err) { toast('セリフJSONを読み込めません：' + err.message); }
    finally { e.target.value = ''; }
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
        if (!allowUnit(target)) throw Error('チャレンジの敵キャラクターは変更できません。');
        const outcome = importUnitTactics(config, targetId, payload);
        cleanWebConfiguration(outcome.config);
        normalizeMoveModes(outcome.config);
        if (!await confirmInApp(`「${target.name}」の現在の装備スキルとキャラAIルールを置き換えます。\n元ファイル：${payload.sourceUnit.name || '名前なし'}\nスキル ${outcome.skillCount} 件 / AIルール ${outcome.ruleCount} 件\n\n能力値やチーム、他キャラの設定は変更されません。続行しますか？`))
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
$('#arena-share-dialog')?.addEventListener('close', () => { shareImportActions = null; });
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
        if (!await confirmInApp(`「${destination.name}」に公式アリーナの戦法を適用します。\n元データ：${outcome.source}\nAI ${outcome.ruleCount}行（「上記のどの条件も満たさない場合」以降は除外）\n未対応スキルの行 ${outcome.unresolved.length}行${details}\n\n現在のAIルールを置き換えます。該当スキルは装備に追加し、その他の装備、能力値、チームは保持します。続行しますか？`))
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
// Restore the last viewport position after the chosen screen has been rendered.
// Keep the scroll state on refresh, but not when navigating to a new screen.
requestAnimationFrame(() => {
    if (savedUi.scrollY > 0) {
        window.scrollTo(0, savedUi.scrollY);
        requestAnimationFrame(() => window.scrollTo(0, savedUi.scrollY));
    }
    initialRestoreScrollY = null;
});
window.addEventListener('scroll', () => {
    // Updates are throttled by the browser; sessionStorage belongs to this tab only.
    if (window.__battleLabUiScrollFrame) return;
    window.__battleLabUiScrollFrame = requestAnimationFrame(() => {
        window.__battleLabUiScrollFrame = 0;
        persistUi();
    });
}, { passive: true });
