// Official Arena share codes are server-side lookup tokens, not locally encoded tactics.
// This adapter never transmits local Battle Lab character data to the official server.
import { clone, freshRule, freshCondition, uid, validateConfig, ARENA_MAX_RULES, BS_NAMES } from './model.js?v=1.18.21&dialogueui=1';
import { OFFICIAL_ACTION_KEYS, OFFICIAL_CONDITION_SPECS, OFFICIAL_METRIC_KEYS, OFFICIAL_MOVE_KEYS, OFFICIAL_SORT_KEYS, OFFICIAL_SUBJECT_KEYS, OFFICIAL_TARGET_KEYS, OFFICIAL_AI } from './official-ai-schema.js?v=1.17.16';

export const DECODER_QUERY = `query DecodeArenaSettings($password: String!) {
  rev2ArenaSettingsDecode(password: $password) {
    active
    conditions { subject params { character_id condition_type param1 param2 bs_list negate } }
    maneuver { maneuver skill_id auto_position move_mode move_target { target params { character_id condition_type param1 param2 bs_list negate } } move_priority dist_min dist_max }
    target { target params { character_id condition_type param1 param2 bs_list negate } }
  }
}`;
const BS_BY_ID = new Map(OFFICIAL_AI.badStatuses.map(b => [String(b.id), b.name]));
const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);

export function validateArenaShareCode(value) {
    const code = String(value || '').trim();
    if (!/^[0-9a-zA-Z]{1,64}$/.test(code)) throw Error('共有コードは半角英数字で入力してください（64文字以内）。');
    return code;
}
/** POST to official site directly. Browser CORS and login policy are entirely controlled by official server. */
export async function fetchArenaShareCode(value, { fetchImpl = fetch, signal } = {}) {
    const password = validateArenaShareCode(value);
    let response;
    // Match the official Apollo request path, including the operation-name query parameter.
    const officialUrl = 'https://rev2.reversion.jp/graphql?opname=DecodeArenaSettings';
    const sameOrigin = typeof location !== 'undefined' && location.origin === new URL(officialUrl).origin;
    try {
        response = await fetchImpl(officialUrl, {
            method: 'POST', mode: 'cors', credentials: sameOrigin ? 'same-origin' : 'include',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({operationName: 'DecodeArenaSettings', variables: {password}, query: DECODER_QUERY}),
            signal
        });
    } catch {
        throw Error('公式への直接通信がブラウザに遮断されました。下の「公式タブで取得」を使用してください。');
    }
    if (!response.ok) throw Error(`公式サイトの照会が失敗しました（HTTP ${response.status}）。ログインや通信許可が必要な可能性があります。`);
    let data;
    try { data = await response.json(); } catch { throw Error('公式サーバーからJSONを取得できませんでした。'); }
    return extractSharedArenaActions(data);
}
/** Accept the exact GraphQL response or its data object or the decoded actions array. */
export function extractSharedArenaActions(input) {
    let x = input;
    if (typeof x === 'string') {
        if (x.length > 1500000) throw Error('レスポンスは1.5MB以内にしてください。');
        try { x = JSON.parse(x); } catch { throw Error('JSONとして読み取れません。Networkのレスポンス全文を指定してください。'); }
    }
    if (isPlain(x) && Array.isArray(x.errors) && x.errors.length)
        throw Error(String(x.errors[0]?.message || '公式APIでエラーが発生しました。').slice(0,240));
    if (isPlain(x) && isPlain(x.data)) x = x.data;
    if (isPlain(x) && Object.hasOwn(x, 'rev2ArenaSettingsDecode')) x = x.rev2ArenaSettingsDecode;
    // For debugging and regression tests, the official action setting response is also accepted.
    if (!Array.isArray(x)) throw Error(isPlain(x) && Object.hasOwn(x, 'rev2ArenaSettingsEncode') ? 'これは共有コードの発行結果です。AI本体を取り込むには rev2ArenaSettingsDecode のレスポンスを指定してください。' : '共有コードの復号結果が含まれていません。rev2ArenaSettingsDecode のレスポンスを指定してください。');
    if (!x.length || x.length > ARENA_MAX_RULES) throw Error(`共有コード内の戦術は1～${ARENA_MAX_RULES}件にしてください。`);
    if (x.some(a => !isPlain(a) || !isPlain(a.maneuver) || !isPlain(a.target) || !Array.isArray(a.conditions) || a.conditions.length > 5))
        throw Error('公式アリーナの戦術データ形式が不正です。');
    return x;
}
const validNumber = (v, fallback) => v === null || v === undefined || v === '' ? fallback : Number(v);
function invalid(message, warnings, issues, index) {
    issues.add(index);
    warnings.push(`${index + 1}行目：${message}`);
}
function normalizedCharacterId(id) {
    const raw = String(id ?? '').trim();
    // The same ID may occur as "r2p000035", "000035", or "35".
    const digits = raw.match(/^(?:r2p)?(\d+)$/i);
    return digits ? `r2p${digits[1].replace(/^0+(?=\d)/, '')}` : raw;
}
function mapOfficialId(id, config) {
    if (id == null || id === '') return '';
    const canonical = normalizedCharacterId(id);
    const found = config.units.filter(u =>
        String(u.id) === String(id) ||
        (u.importedProfile?.characterId != null &&
            normalizedCharacterId(u.importedProfile.characterId) === canonical));
    // IDs belonging to multiple units must not be guessed.
    return found.length === 1 ? found[0].id : '';
}
function mapBs(ids, warnings, issues, i) {
    if (!Array.isArray(ids) || !ids.length) return [];
    const selected = ids.map(id => BS_BY_ID.get(String(id)) || (BS_NAMES.includes(id) ? id : null));
    if (selected.some(v => !v)) invalid('未確認のBS IDが含まれています。', warnings, issues, i);
    return selected.filter(Boolean);
}
function convertParams(source, warnings, issues, i, { target = false } = {}) {
    const p = source?.params || {};
    const officialType = p.condition_type || 'IsActive';
    const priority = OFFICIAL_SORT_KEYS[officialType];
    if (target && priority) return { type: 'sort', sort: priority };
    const metric = OFFICIAL_METRIC_KEYS[officialType];
    if (!metric) {
        invalid(`未対応の条件 ${String(officialType).slice(0, 40)}`, warnings, issues, i);
        return target ? null : freshCondition();
    }
    const spec = OFFICIAL_CONDITION_SPECS[metric];
    const min = spec?.has_range ? validNumber(p.param1, spec.range_min) : 0;
    const max = spec?.has_range ? validNumber(p.param2, spec.range_max) : 100;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max ||
        (spec?.has_range && (min < spec.range_min || max > spec.range_max))) {
        invalid('条件の数値範囲が公式仕様から外れています。', warnings, issues, i);
    }
    return { metric, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 100,
        not: !!p.negate, bs: mapBs(p.bs_list, warnings, issues, i) };
}
function convertCondition(source, config, warnings, issues, i) {
    const subject = OFFICIAL_SUBJECT_KEYS[source?.subject];
    const p = source?.params || {};
    if (!subject) {
        invalid(`未対応の判定対象 ${String(source?.subject)}`, warnings, issues, i);
        return freshCondition();
    }
    if (subject === 'turn') return { ...freshCondition(), type:'turn', multiple: validNumber(p.param1, 1),
        offset: validNumber(p.param2, 0), not: !!p.negate };
    if (subject === 'afterWait') return { ...freshCondition(), type:'afterWait', not: !!p.negate };
    if (subject === 'chance') return { ...freshCondition(), type:'chance', chance: validNumber(p.param1, 50), not: !!p.negate };
    const c = convertParams(source, warnings, issues, i);
    const characterId = subject === 'id' ? mapOfficialId(p.character_id, config) : '';
    if (subject === 'id' && !characterId) invalid(`指定キャラクターID「${String(p.character_id || '')}」が編成内で特定できません。編成内のIDを指定し直してください。`, warnings, issues, i);
    return { ...freshCondition(), ...c, type:'who', subject, characterId: subject === 'id' ? (characterId || String(p.character_id || '')) : '',
        arenaCharacterId: subject === 'id' ? String(p.character_id || '') : '' };
}
function convertTarget(source, config, warnings, issues, i) {
    const subject = OFFICIAL_TARGET_KEYS[source?.target];
    if (!subject) invalid(`未対応の行使対象 ${String(source?.target)}`, warnings, issues, i);
    const rawId = source?.params?.character_id;
    const targetId = subject === 'id' ? mapOfficialId(rawId, config) : '';
    if (subject === 'id' && !targetId) invalid(`対象ID「${String(rawId || '')}」が編成内で特定できません。`, warnings, issues, i);
    const criterion = convertParams(source, warnings, issues, i, {target:true});
    return {
        subject: subject || 'self', unitId: subject === 'id' ? (targetId || String(rawId || '')) : '',
        sourceId: subject === 'id' ? String(rawId || '') : '',
        criteria: criterion ? [criterion.type === 'sort' ? criterion : {...criterion, type:'filter'}] : []
    };
}
function matchSkillByOfficialId(config, unit, officialId) {
    const id = String(officialId ?? '').trim();
    if (!id) return '';
    // When an imported skill is reused from the global WIKI catalog, its official
    // skill ID is kept on the UNIT's specialization metadata, not the catalog row.
    const candidates = config.skills.filter(s => unit.skills.includes(s.id) && [
        s.id,
        s.originSkillId,
        s.importedFromCharacter?.originalId,
        s.importedFromCharacter?.skillId,
        s.importedProfile?.skillId,
        unit.officialSkillIds?.[s.id],
        unit.specializedSkills?.[s.id]?.originSkillId
    ].some(v => v != null && String(v).trim() === id));
    return candidates.length === 1 ? candidates[0].id : '';
}
export function convertArenaSharedActions(actions, config, unitId, { mode = 'replace' } = {}) {
    const list = extractSharedArenaActions(actions);
    const unit = config?.units?.find(u => u.id === unitId);
    if (!unit) throw Error('読み込み先のキャラクターが見つかりません。');
    if (!['replace', 'append'].includes(mode)) throw Error('取り込み方法が不正です。');
    if (mode === 'append' && unit.rules.length + list.length > ARENA_MAX_RULES)
        throw Error(`戦術の合計が最大${ARENA_MAX_RULES}件を超えます。`);
    const next = clone(config), dst = next.units.find(u => u.id === unitId), warnings = [], issues = new Set();
    let unresolvedSkills = 0;
    const rules = list.map((a, i) => {
        const cm = a.maneuver, type = OFFICIAL_ACTION_KEYS[cm.maneuver];
        if (!type) invalid(`未対応の行動 ${String(cm.maneuver)}`, warnings, issues, i);
        if (a.conditions.length > 5) invalid('条件が5件を超えています。', warnings, issues, i);
        const conditions = a.conditions.map(c => convertCondition(c, next, warnings, issues, i));
        const target = convertTarget(a.target, next, warnings, issues, i);
        const r = freshRule({ enabled: !!a.active, conditions, action: type === 'autoMove' ? 'move' : type || 'carry',
            target: target.subject, targetUnitId: target.unitId,
            targetCriteria: target.criteria, sort: target.criteria.find(c => c.type === 'sort')?.sort || 'nearest',
            autoMove: !!cm.auto_position, moveMode: OFFICIAL_MOVE_KEYS[cm.move_mode || 'Fixed'] || 'fixed',
            minDist: cm.dist_min === null || cm.dist_min === undefined ? null : Number(cm.dist_min),
            maxDist: cm.dist_max === null || cm.dist_max === undefined ? null : Number(cm.dist_max),
            arenaOriginalTargetId: target.sourceId || '' });
        if (type === 'autoMove') r.autoMove = true;
        if (!OFFICIAL_MOVE_KEYS[cm.move_mode || 'Fixed']) invalid(`未対応の移動方式 ${cm.move_mode}`,warnings,issues,i);
        if (r.action === 'skill') {
            const officialSkillId = String(cm.skill_id ?? '');
            r.arenaSkillId = officialSkillId;
            if (officialSkillId === '0') {r.action = 'attack';}
            else {
                const known = matchSkillByOfficialId(next, dst, officialSkillId);
                if (known) r.skillId = known;
                else {
                    unresolvedSkills++;
                    invalid(`公式スキルID「${officialSkillId}」を装備済みスキルから照合できません。行動を手動選択して有効化してください。`, warnings, issues, i);
                }
            }
        }
        if (cm.move_target) {
            if (cm.move_priority && !['Action', 'Move', 'Movement'].includes(cm.move_priority))
                invalid(`未対応の移動優先設定 ${String(cm.move_priority)}`,warnings,issues,i);
            const t = convertTarget(cm.move_target, next, warnings, issues, i);
            r.splitMovement = true;
            r.moveTargetMode = 'individual';
            r.moveSubject = t.subject;
            r.moveUnitId = t.unitId;
            r.moveConditions = t.criteria.filter(c=>c.type==='filter').map(c=>({ ...freshCondition(), ...c, type:'who',subject:t.subject }));
            r.moveSort = t.criteria.find(c=>c.type==='sort')?.sort || 'nearest';
            r.movePriority = cm.move_priority === 'Movement' || cm.move_priority === 'Move' ? 'movement' : 'action';
        }
        if (r.minDist != null && (!Number.isInteger(r.minDist) || r.minDist < 0 || r.minDist > 999) ||
            r.maxDist != null && (!Number.isInteger(r.maxDist) || r.maxDist < 0 || r.maxDist > 999))
            invalid('移動距離は0～999mの整数で指定してください。',warnings,issues,i);
        if (issues.has(i)) r.enabled = false;
        // The official share code is stored as metadata for later manual reconciliation.
        return r;
    });
    dst.rules = mode === 'append' ? [...dst.rules, ...rules] : rules;
    const errors = validateConfig(next);
    if (errors.length) throw Error(`読み込みデータを適用できません：${errors.join('／')}`);
    if (issues.size) warnings.unshift(`確認が必要な行を${issues.size}件無効化しました。未対応のIDやスキルは推測で補いません。`);
    return {config: next, ruleCount: rules.length, disabledCount: rules.filter(r=>!r.enabled).length,
        unresolvedSkills, warnings};
}
