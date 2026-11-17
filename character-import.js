import { STAT_LABELS, EFFECTS, BS_NAMES, freshSkill, freshUnit, freshRule, clone, uid } from './model.js';
import { readConditionalPassives } from './conditional-passives.js?v=1.17.28';
import { extractMainCharacterElement, ELEMENT_ID_TO_KEY } from './element-bonus.js?v=1.17.16';
import { findReusableImportedSkill } from './skill-dedup.js';
import { normalizeLegacyBarrierSkill } from './barrier-rules.js';
const statNames = {
    HP: 'maxHp',
    AP: 'maxAp',
    ...Object.fromEntries(Object.entries(STAT_LABELS).map(([k, v]) => [v, k])),
    主攻: 'main',
    副攻: 'sub',
    回復: 'heal',
    防技: 'defense',
    抵抗: 'resist',
    機動: 'mobility',
    CT: 'critical',
    FB: 'fumble'
};
const effectNames = Object.fromEntries(Object.entries(EFFECTS).map(([k, v]) => [v.normalize('NFKC').replace(/\s+/g, ''), k]));
const normalizedLabel = value => visibleText(value).normalize('NFKC').replace(/\s+/g, '');
// Only apply official sub-status entries whose names are implemented in the battle engine.
// Unknown entries remain visible in the import report; never silently invent mechanics.
export function readImportedStatusRows(rows) {
    const stats = {}, effects = {}, otherStats = [], unknown = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const name = normalizedLabel(row.name), abbr = normalizedLabel(row.abbr);
        const numeric = Number(row.value);
        const numericOK = row.value !== null && row.value !== '' && Number.isFinite(numeric) && Math.abs(numeric) <= 1e9;
        const key = statNames[name] || statNames[abbr];
        if (key) { if (numericOK) stats[key] = numeric; else unknown.push(name || abbr); continue; }
        const effect = effectNames[name] || effectNames[abbr];
        if (effect) { if (numericOK) effects[effect] = numeric; else unknown.push(name || abbr); continue; }
        otherStats.push({name: name || abbr, value: row.value, type: row.type});
        if (numericOK && numeric !== 0 && row.type !== 'ELEMENT' && name !== '活性限界値')
            unknown.push(`${name || abbr} ${numeric}`);
    }
    return {stats, effects, otherStats, unknown};
}
const rangeNames = {
    至: 'touch',
    近: 'near',
    中: 'mid',
    遠: 'far',
    超: 'super',
    特レ: 'special',
    自: 'touch'
};
const scopeNames = {
    単: 'single',
    範: 'area',
    域: 'wide',
    貫: 'pierce',
    扇: 'cone',
    列: 'line',
    ラ: 'random',
    特: 'special'
};
// Only visible text is used. Never render or evaluate upstream HTML.
export function visibleText(value) {
    return String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => {
        if (e[0] === '#') {
            const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
        }
        return {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' '
        }[e.toLowerCase()];
    }).trim();
}
export function parseCharacterURL(value) {
    let u;
    try {
        u = new URL(String(value).trim());
    }
    catch {
        throw Error('キャラクター詳細ページのURLを入力してください。');
    }
    const m = u.pathname.match(/^\/character\/detail\/(r2p\d{6})\/?$/);
    if (u.protocol !== 'https:' || u.hostname !== 'rev2.reversion.jp' || u.port || u.username || u.password || !m)
        throw Error('https://rev2.reversion.jp/character/detail/r2p000035 の形式で入力してください。');
    return { id: m[1], url: `https://rev2.reversion.jp/character/detail/${m[1]}` };
}
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
export function parseActiveSkill(raw, index = 0) {
    const original = visibleText(raw?.display_effects), issues = [];
    const name = visibleText(raw?.name) || `名称未取得 ${index + 1}`;
    const s = freshSkill({
        id: `source-${index}`,
        name,
        mainBonus: 0,
        subBonus: 0,
        hitBonus: 0,
        power: 0,
        effects: {},
        castMods: {},
        grantedEffects: {},
        selfModifiers: {},
        selfEffects: {},
        elements: {},
        elementCorrection: 0,
        original,
        note: visibleText(raw?.description),
        source: '公開キャラクターページ',
        originSkillId: String(raw?.id ?? index),
        baseName: visibleText(raw?.specialization_base?.name),
        unmodeled: []
    });
    const active = raw?.active;
    if (!active || !finite(active.ap_cost) || active.ap_cost < 0 || !finite(active.ticks) || active.ticks < 0)
        issues.push('消費AP・行動値を取得できません');
    else {
        s.ap = active.ap_cost;
        s.cost = active.ticks;
    }
    const normalized = original.normalize('NFKC').replace(/\s+/g, '');
    const prefix = normalized.match(/^(?:【効果】)?(特レ|至|近|中|遠|超|自)(単|範|域|貫|扇|列|ラ|特)?[:：]/);
    if (!prefix)
        issues.push('射程・効果範囲を解析できません');
    else {
        s.range = rangeNames[prefix[1]];
        s.scope = prefix[1] === '自' ? ({ 単: 'self', 範: 'selfArea', 域: 'selfWide' }[prefix[2]] || 'self') : (scopeNames[prefix[2]] || 'special');
    }
    const tags = [...normalized.matchAll(/【(.*?)】/g)].map(m => m[1]);
    const base = normalized.replace(prefix?.[0] || /^$/, '').replace(/【.*?】/g, '');
    for (const token of base.split(/[、,]/).filter(Boolean)) {
        let m = token.match(/^(主攻|副攻|命中|CT|FB)([+-]?\d+(?:\.\d+)?)$/);
        if (m) {
            if (['CT', 'FB'].includes(m[1]))
                s.castMods[statNames[m[1]]] = Number(m[2]);
            else
                s[{ 主攻: 'mainBonus', 副攻: 'subBonus', 命中: 'hitBonus' }[m[1]]] = Number(m[2]);
            continue;
        }
        m = token.match(/^(HP|AP|HA)回復力(÷2)?([+-]\d+(?:\.\d+)?)?$/);
        if (m) {
            s.kind = { HP: 'hp', AP: 'ap', HA: 'ha' }[m[1]];
            s.power = Number(m[3] || 0);
            if (m[2] && m[1] !== 'HA')
                issues.push(token);
            continue;
        }
        m = token.match(/^(火|水|土|風|光|闇|無)([+-]\d+)$/);
        if (m) {
            s.elements[m[1]] = Number(m[2]);
            continue;
        }
        issues.push(token);
    }
    for (let tag of tags) {
        if (['効果', '治癒'].includes(tag) || tag.startsWith('シナリオ時') || tag.startsWith('装制'))
            continue;
        if (['HP回復', 'AP回復', 'HA回復'].includes(tag)) {
            s.kind = { HP回復: 'hp', AP回復: 'ap', HA回復: 'ha' }[tag];
            continue;
        }
        if (tag === '迎撃' || tag === '報復') {
            s.trigger = tag === '迎撃' ? 'intercept' : 'retaliate';
            continue;
        }
        let mode = 'cast';
        if (tag.startsWith('付:')) {
            mode = 'grant';
            tag = tag.slice(2);
        }
        else if (tag.startsWith('自:')) {
            mode = 'self';
            tag = tag.slice(2);
        }
        const m = tag.match(/^(.+?)([+-]?\d+(?:\.\d+)?)$/);
        if (mode !== 'cast' && m && statNames[m[1]]) {
            s[mode === 'grant' ? 'modifiers' : 'selfModifiers'][statNames[m[1]]] = Number(m[2]);
            continue;
        }
        if (mode === 'cast' && BS_NAMES.includes(tag)) {
            s.bs.push(tag);
            continue;
        }
        const key = effectNames[tag] || effectNames[m?.[1]];
        if (key) {
            s[{ cast: 'effects', grant: 'grantedEffects', self: 'selfEffects' }[mode]][key] = effectNames[tag] ? 1 : Number(m[2]);
            continue;
        }
        issues.push(tag);
    }
    if (tags.includes('治癒') && s.kind === 'attack')
        s.kind = 'cleanse';
    if (s.kind === 'attack' && (Object.keys(s.modifiers).length || Object.keys(s.selfModifiers).length || Object.keys(s.grantedEffects).length || Object.keys(s.selfEffects).length) && !/主攻|命中/.test(base))
        s.kind = 'buff';
    if (s.kind === 'buff' && prefix?.[1] === '自') {
        Object.assign(s.modifiers, s.selfModifiers);
        Object.assign(s.grantedEffects, s.selfEffects);
        s.selfModifiers = {};
        s.selfEffects = {};
    }
    if (prefix?.[1] === '特レ') {
        issues.push('特殊射程・対象人数は手動設定が必要です');
    }
    if (s.cost + (s.effects.chargeTime || 0) < 1)
        issues.push('行動値と溜が両方0です');
    // ENCHANTMENT is the official category for Accel Kaleido grants.
    // Its parsed 付/自 effects use the existing buff engine; unfamiliar tags
    // still keep the skill as a non-equipped review draft.
    if (active?.category === 'ENCHANTMENT') {
        const hasGrants = Object.keys(s.modifiers).length || Object.keys(s.grantedEffects).length ||
            Object.keys(s.selfModifiers).length || Object.keys(s.selfEffects).length;
        if (!hasGrants)
            issues.push('AKの付与効果を解析できません');
        else if (s.mainBonus || s.subBonus || s.hitBonus || s.power)
            issues.push('AKの攻撃・付与複合効果は手動確認が必要です');
        else
            s.kind = 'buff';
    }
    // An unfamiliar category must not silently become an attack.
    if (active?.category && !['ATTACK', 'HEAL', 'SUPPORT', 'BUFF', 'ENCHANTMENT'].includes(active.category))
        issues.push(`未対応の分類 ${active.category}`);
    normalizeLegacyBarrierSkill(s);
    s.unmodeled = [...new Set(issues)];
    return {
        name,
        original: s.original,
        baseName: s.baseName,
        originSkillId: s.originSkillId,
        issues: s.unmodeled,
        supported: issues.length === 0,
        skill: s
    };
}
export function parseCharacterData(data, sourceURL, at = new Date().toISOString()) {
    const { id, url } = parseCharacterURL(sourceURL), c = data?.data?.character;
    if (data?.errors?.length)
        throw Error('公開データの取得に失敗しました。時間をおいて再度お試しください。');
    if (!c || c.character_id !== id)
        throw Error('キャラクターが見つからないか、公開されていません。');
    if (!Array.isArray(c.sub_status))
        throw Error('能力値が公開されていません。');
    const element = extractMainCharacterElement(c.sub_status);
    if (!element)
        throw Error('7属性の属性ID・属性値が揃っていません。元属性を特定できないため読み込みを中止しました。');
    const {stats, effects, otherStats, unknown} = readImportedStatusRows(c.sub_status);
    const immunities = [], warnings = [];
    if (element.value > 0 && c.sub_status.filter(row =>
        row?.type === 'ELEMENT' && ELEMENT_ID_TO_KEY[row.id] && Number(row.value) === element.value).length > 1)
        warnings.push(`属性値${element.value}が同率で複数あります。${element.key}を採用しました。必要なら設定欄で変更してください。`);
    for (const label of unknown)
        warnings.push(`その他のステータス「${label}」は戦闘への自動反映に未対応です。`);
    const missing = Object.keys(STAT_LABELS).filter(k => !finite(stats[k]));
    if (missing.length)
        warnings.push(`未取得の能力値：${missing.map(k => STAT_LABELS[k]).join('、')}`);
    const rawSkills = c.skills;
    if (!rawSkills || !Array.isArray(rawSkills.a) || !Array.isArray(rawSkills.ex_a))
        throw Error('装備スキルが公開されていません。');
    const seen = new Set(), skills = [];
    for (const r of [...rawSkills.a, ...rawSkills.ex_a]) {
        if (seen.has(String(r.id)))
            continue;
        seen.add(String(r.id));
        skills.push(parseActiveSkill(r, skills.length));
    }
    const references = [['常時補正', rawSkills.p], ['クラス', c.classes], ['エスプリ', c.esprits]].flatMap(([category, list]) => (list || []).map(r => ({ category, name: visibleText(r.name), original: visibleText(r.display_effects) })));
    const conditional = readConditionalPassives({ p: rawSkills.p, classes: c.classes, esprits: c.esprits });
    if (!Array.isArray(rawSkills.p))
        warnings.push('公式のパッシヴスキル一覧が取得できませんでした。条件付きパッシブの自動反映は確認できません。');
    warnings.push(...conditional.warnings);
    const unsupported = skills.filter(s => !s.supported);
    if (unsupported.length)
        warnings.push(`${unsupported.length}件のスキルは未対応の効果があるため、自動セットされません。効果文を確認し、カスタムスキルで設定してください。`);
    if (stats.maxHp < 1 || stats.maxAp < 0 || stats.mobility < 0)
        throw Error('HP・AP・機動力がシミュレーターの入力範囲外です。');
    return {
        characterId: id,
        sourceURL: url,
        fetchedAt: at,
        name: visibleText(c.name),
        level: c.level,
        stats,
        element,
        effects,
        immunities,
        conditionalPassives: conditional.entries,
        skills,
        references,
        otherStats,
        missing,
        warnings
    };
}
export function createImportedUnit(profile, { team = 'A', normalRange = 'near', replace = null, count = 0, existingSkills = [] } = {}) {
    if (profile.missing.length)
        throw Error('必要な能力値を取得できなかったため、取り込みを中止しました。');
    const skills = [], equipment = [], skillAliases = {}, specializedSkills = {}, officialSkillIds = {};
    let reused = 0;
    for (const entry of profile.skills.filter(r => r.supported)) {
        let existing = findReusableImportedSkill([...existingSkills, ...skills], entry.skill);
        // Different names within the same character must not silently share one slot.
        if (existing && equipment.includes(existing.id) &&
            (skillAliases[existing.id] || existing.name) !== entry.name)
            existing = null;
        let skillId;
        if (existing) {
            equipment.push(existing.id);
            skillId = existing.id;
            reused++;
            if (entry.name !== existing.name)
                skillAliases[existing.id] = entry.name;
        }
        else {
            // No matching WIKI/public skill: treat it as an editable Accel Kaleido.
            const created = { ...clone(entry.skill), id: uid('acc') };
            delete created.source;
            created.importedFromCharacter = { characterId: profile.characterId, skillId: entry.originSkillId || null, url: profile.sourceURL };
            skills.push(created);
            equipment.push(created.id);
            skillId = created.id;
        }
        // Preserve the source ID even when an existing WIKI skill is reused without
        // specialization or alias. The shared AI uses these original skill IDs.
        if (entry.originSkillId != null && entry.originSkillId !== '')
            officialSkillIds[skillId] = String(entry.originSkillId);
        const baseName = entry.skill.baseName;
        if ((baseName && baseName !== entry.name) || (existing && entry.name !== existing.name)) {
            specializedSkills[skillId] = {
                name: entry.name,
                baseName: baseName || existing?.name || entry.name,
                note: entry.skill.note || '',
                original: entry.skill.original || '',
                originSkillId: entry.originSkillId || null
            };
        }
    }
    // A partially parsed skill cannot be simulated safely. Preserve it as a
    // non-equipped, editable Accel draft instead of dropping it or guessing data.
    let drafts = 0;
    for (const entry of profile.skills.filter(r => !r.supported)) {
        const matches = [...existingSkills, ...skills];
        const found = matches.find(s => s.requiresReview && s.importedFromCharacter?.characterId === profile.characterId && s.importedFromCharacter?.skillId === entry.originSkillId && s.name === entry.name);
        if (found)
            continue;
        const created = { ...clone(entry.skill), id: uid('acc'), requiresReview: true };
        delete created.source;
        created.importedFromCharacter = { characterId: profile.characterId, skillId: entry.originSkillId || null, url: profile.sourceURL };
        created.note = `公開スキルの解析未完了：${entry.issues.join('、')}。効果文と数値を確認し、アクセルカレイドで編集・保存してから装備してください。\n${created.note || ''}`;
        skills.push(created);
        drafts++;
    }
    const u = freshUnit({
        id: replace?.id || uid('u'),
        name: profile.name,
        team,
        ...profile.stats,
        element: clone(profile.element),
        normalRange,
        x: replace?.x ?? (team === 'A' ? -10 : 10),
        y: replace?.y ?? 0,
        skills: [...new Set(equipment)],
        skillAliases,
        specializedSkills,
        officialSkillIds,
        effects: clone(profile.effects),
        conditionalPassives: clone(profile.conditionalPassives || []),
        immunities: clone(profile.immunities),
        rules: [freshRule({ action: 'effectiveAttack', moveMode: 'approach' }), freshRule({ conditions: [], action: 'carry', autoMove: false, target: 'self' })],
        importedProfile: {
            characterId: profile.characterId,
            url: profile.sourceURL,
            fetchedAt: profile.fetchedAt,
            references: clone(profile.references),
            otherStats: clone(profile.otherStats),
            warnings: clone(profile.warnings),
            unsupported: profile.skills.filter(r => !r.supported).map(({ name, original, issues }) => ({ name, original, issues }))
        }
    });
    return {
        unit: u,
        skills,
        reused,
        renamed: Object.keys(skillAliases).length,
        drafts
    };
}
