// Battle Lab Worker — public shared-AI read endpoint and private admin verification.
// Official credentials remain in Cloudflare Secrets; never return session cookies.
const ALLOWED_ORIGINS = new Set(['https://haruaki-yuga.github.io']);

const OFFICIAL_ORIGIN = 'https://rev2.reversion.jp';

const SESSION_TTL_MS = 15 * 60 * 1000;

const LOGIN_COOLDOWN_MS = 60 * 1000;

const MAX_UPSTREAM_BYTES = 2000000;
// Production: configure a Cloudflare Rate Limiting binding named ARENA_RATE_LIMITER.
// Its API is approximate and regional; the local fallback is only a limited safety net.
const FALLBACK_LIMIT = 5;
const FALLBACK_WINDOW_MS = 60000;
const FALLBACK_MAX_IPS = 4096;



const CHARACTER_QUERY = `query GetCharacterDetail($character_id: String!) {

 character: rev2GetCharacterDetail(character_id: $character_id) {

  character_id name level

  sub_status { id type name abbr value }

  skills {

   a { ...Skill active { category ap_cost ticks power hit critical fumble } }

   p { ...Skill }

   ex_a { ...Skill active { category ap_cost ticks power hit critical fumble } }

  }

  classes { ...Skill } esprits { ...Skill }

 }

}

fragment Skill on Rev2CharacterSpecField {

 id name description display_effects specialization_base { name }

}`;

const LOGIN_QUERY = `mutation login($email: String!, $password: String!) {

 rev2Login(email: $email, password: $password)

}`;

const ME_QUERY = `query GetMe {

 rev2Me {

  current_character { character_id }

  my_characters { character_id }

 }

}`;

const CHARACTER_SELECT_QUERY = `mutation updateLastActiveCharacter($character_id: String!) {

 rev2ChangeCharacter(character_id: $character_id)

}`;

const DECODE_QUERY = `query DecodeArenaSettings($password: String!) {

 rev2ArenaSettingsDecode(password: $password) {

  active

  conditions { subject params { character_id condition_type param1 param2 bs_list negate } }

  maneuver {

   maneuver skill_id auto_position move_mode move_priority dist_min dist_max

   move_target { target params { character_id condition_type param1 param2 bs_list negate } }

  }

  target { target params { character_id condition_type param1 param2 bs_list negate } }

 }

}`;



class ApiError extends Error {

  constructor(code, message, stage, status = 502) {

    super(message);

    Object.assign(this, { code, stage, status });

  }

}

function json(value, status = 200, headers = {}) {

  return new Response(JSON.stringify(value), { status, headers: {

    'Content-Type': 'application/json; charset=utf-8',

    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers

  }});

}

function cors(origin, arena = false) {

  return { 'Access-Control-Allow-Origin': origin,

    'Access-Control-Allow-Methods': 'POST, OPTIONS',

    'Access-Control-Allow-Headers': arena ? 'Content-Type, Authorization' : 'Content-Type',

    'Access-Control-Max-Age': '3600', 'Vary': 'Origin' };

}

async function readLimited(response, limit) {

  if (Number(response.headers.get('Content-Length')) > limit) throw Error('取得データが大きすぎます。');

  const reader = response.body?.getReader();

  if (!reader) throw Error('応答を読み込めません。');

  let length = 0;

  const parts = [];

  try {

    for (;;) {

      const {done, value} = await reader.read();

      if (done) break;

      length += value.length;

      if (length > limit) throw Error('取得データが大きすぎます。');

      parts.push(value);

    }

  } finally { await reader.cancel().catch(() => {}); }

  const bytes = new Uint8Array(length);

  let offset = 0;

  for (const part of parts) { bytes.set(part, offset); offset += part.length; }

  return JSON.parse(new TextDecoder().decode(bytes));

}

function parseURL(value) {

  let url;

  try { url = new URL(String(value || '').trim()); }

  catch { throw Error('キャラクターURLを入力してください。'); }

  const match = url.pathname.match(/^\/character\/detail\/(r2p\d{6})\/?$/);

  if (url.protocol !== 'https:' || url.hostname !== 'rev2.reversion.jp' ||

      url.port || url.username || url.password || !match)

    throw Error('公式サイトのキャラクター詳細URLを入力してください。');

  return match[1];

}



// Cloudflare exposes getAll('Set-Cookie'); newer runtimes also have getSetCookie.

// Fallback does not split the comma in an Expires date.

function setCookieLines(headers) {

  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();

  if (typeof headers.getAll === 'function') return headers.getAll('Set-Cookie');

  const combined = headers.get('Set-Cookie');

  return combined ? combined.split(/,(?=\s*[!#$%&'*+.^_`|\~0-9A-Za-z-]+=)/) : [];

}

class CookieJar {

  constructor(now = Date.now) { this.cookies = new Map(); this.now = now; }

  absorb(headers) {

    for (const line of setCookieLines(headers)) {

      const [pair, ...rawAttrs] = line.split(';');

      const eq = pair.indexOf('=');

      if (eq <= 0) continue;

      const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();

      if (!/^[!#$%&'*+.^_`|\~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) continue;

      const attrs = new Map(rawAttrs.map(item => {

        const p = item.indexOf('=');

        return p < 0 ? [item.trim().toLowerCase(), ''] :

          [item.slice(0, p).trim().toLowerCase(), item.slice(p + 1).trim()];

      }));

      const domain = (attrs.get('domain') || 'rev2.reversion.jp').replace(/^\\./, '').toLowerCase();

      // Only cookies eligible for the fixed official host can enter this jar.

      if (!['rev2.reversion.jp', 'reversion.jp'].includes(domain)) continue;

      const path = attrs.get('path')?.startsWith('/') ? attrs.get('path') : '/';

      let expires = Infinity;

      const age = attrs.get('max-age');

      if (age !== undefined && /^-?\d+$/.test(age)) expires = this.now() + Number(age) * 1000;

      else if (attrs.has('expires')) {

        const parsed = Date.parse(attrs.get('expires'));

        if (Number.isFinite(parsed)) expires = parsed;

      }

      const key = `${name}\t${domain}\t${path}`;

      if (expires <= this.now()) this.cookies.delete(key);

      else this.cookies.set(key, {name, value, path, expires});

    }

  }

  header(path = '/graphql') {

    const eligible = [];

    for (const [key, c] of this.cookies) {

      if (c.expires <= this.now()) { this.cookies.delete(key); continue; }

      if (path === c.path || (path.startsWith(c.path) &&

          (c.path.endsWith('/') || path[c.path.length] === '/'))) eligible.push(c);

    }

    return eligible.sort((a, b) => b.path.length - a.path.length)

      .map(c => `${c.name}=${c.value}`).join('; ');

  }

}

async function digest(text) {

  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

}

async function equalSecret(a, b) {

  const [x, y] = await Promise.all([digest(a), digest(b)]);

  let difference = 0;

  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];

  return difference === 0;

}

function configuration(env) {

  const missing = ['REV2_EMAIL', 'REV2_PASSWORD', 'REV2_CHARACTER_ID']

    .filter(key => typeof env[key] !== 'string' || !env[key].length);

  if (missing.length) throw new ApiError('MISSING_SECRETS',

    `CloudflareのSecretに ${missing.join('、')} を設定してください。`, 'configuration', 503);

  const email = env.REV2_EMAIL.trim(), password = env.REV2_PASSWORD;

  const characterId = env.REV2_CHARACTER_ID.trim();

  if (!email.includes('@') || email.length > 254 || password.length > 4096 ||

      !/^r2p\d{6}$/.test(characterId)) throw new ApiError('INVALID_CONFIGURATION',

    'メールアドレス・パスワード・キャラクターIDの設定形式を確認してください。', 'configuration', 503);

  return {email, password, characterId};

}

function checkedActions(value) {

  if (!Array.isArray(value) || value.length < 1)

    throw new ApiError('INVALID_AI_RESPONSE', '共有コードに対応するAI戦術が返りませんでした。', 'decode');

  for (const action of value) {

    if (!action || typeof action.active !== 'boolean' ||

        !Array.isArray(action.conditions) ||

        !action.maneuver || !action.target)

      throw new ApiError('INVALID_AI_RESPONSE', 'AI戦術の応答形式を確認できませんでした。', 'decode');

  }

  return value;

}



// Injectable dependencies are for offline tests only. External requests cannot

// choose an upstream URL, GraphQL query, credentials, character ID, or headers.

function createWorker({fetchImpl = (...args) => fetch(...args), now = Date.now} = {}) {

  const state = {session: null, fingerprint: '', tail: Promise.resolve(), cooldownUntil: 0, publicHits: new Map()};

  function serial(fn) {

    const task = state.tail.then(fn, fn);

    state.tail = task.catch(() => {});

    return task;

  }

  async function gql(operationName, query, variables, jar, stage) {

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

    const cookie = jar.header();

    if (cookie) headers.Cookie = cookie;

    let response;

    try {

      response = await fetchImpl(`${OFFICIAL_ORIGIN}/graphql?opname=${operationName}`, {

        method: 'POST', headers,

        body: JSON.stringify({operationName, query, variables}),

        redirect: 'manual', signal: AbortSignal.timeout(15000)

      });

    } catch (error) {

      throw new ApiError(error?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK',

        error?.name === 'TimeoutError' ? '公式サイトへの通信がタイムアウトしました。' : '公式サイトへの通信に失敗しました。', stage);

    }

    // Process Cookie rotation without exposing Set-Cookie on our own response.

    jar.absorb(response.headers);

    if (!response.ok) {

      await response.body?.cancel().catch(() => {});

      throw new ApiError(response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : `UPSTREAM_HTTP_${response.status}`,

        `公式サイトの応答がHTTP ${response.status}でした。`, stage);

    }

    if (!response.headers.get('Content-Type')?.toLowerCase().includes('json')) {

      await response.body?.cancel().catch(() => {});

      throw new ApiError('UPSTREAM_NON_JSON', '公式サイトからJSONが返りませんでした。追加認証やアクセス制限の可能性があります。', stage);

    }

    let payload;

    try { payload = await readLimited(response, MAX_UPSTREAM_BYTES); }

    catch { throw new ApiError('UPSTREAM_INVALID_JSON', '公式サイトの応答を読み込めませんでした（形式・サイズ）。', stage); }

    if (Array.isArray(payload?.errors) && payload.errors.length) {

      // Classify internally; never return raw upstream errors that may echo input.

      const loginRequired = payload.errors.some(e =>

        /ログインが必要|ログインしてください|unauthenticated|not authenticated|セッション.{0,20}(切れ|無効)/i.test(String(e?.message || '')));

      if (loginRequired) throw new ApiError('SESSION_REQUIRED', '公式サイトのキャラクターログインが認識されませんでした。', stage);

      const messages = { login: '公式ログインが拒否されました。Secretの設定を確認してください。',

        session: 'ログイン後のアカウント確認に失敗しました。',

        character: '指定したキャラクターへの切り替えに失敗しました。',

        decode: '共有コードを取得できませんでした。コードの有効性を確認してください。' };

      throw new ApiError('OFFICIAL_GRAPHQL_ERROR', messages[stage] || '公式APIでエラーが発生しました。', stage);

    }

    if (!payload || typeof payload.data !== 'object' || payload.data === null)

      throw new ApiError('UPSTREAM_EMPTY_DATA', '公式APIからデータが返りませんでした。', stage);

    return payload.data;

  }

  async function authenticate(config, steps) {

    if (now() < state.cooldownUntil) throw new ApiError('LOGIN_COOLDOWN',

      'ログインの連続試行を停止しています。設定を確認し、60秒ほど待ってください。', 'login', 429);

    const jar = new CookieJar(now);

    state.session = null;

    try {

      const result = await gql('login', LOGIN_QUERY,

        {email: config.email, password: config.password}, jar, 'login');

      if (!result.rev2Login) throw new ApiError('LOGIN_REJECTED',

        '公式ログインが成立しませんでした。Secretの設定を確認してください。', 'login');

      steps.push({stage: 'login', ok: true});

      if (!jar.header()) throw new ApiError('LOGIN_COOKIE_MISSING',

        'ログイン応答から有効なセッションCookieを受け取れませんでした。', 'session');

      const account = await gql('GetMe', ME_QUERY, {}, jar, 'session');

      if (!account.rev2Me) throw new ApiError('SESSION_REQUIRED',

        'ログイン後のセッションが認識されませんでした。', 'session');

      const owned = account.rev2Me.my_characters;

      if (!Array.isArray(owned) || !owned.some(c => c?.character_id === config.characterId))

        throw new ApiError('CHARACTER_NOT_OWNED',

          'REV2_CHARACTER_IDが、このアカウントで選択できるキャラクター一覧にありません。', 'character');

      steps.push({stage: 'session', ok: true});

      const changed = await gql('updateLastActiveCharacter', CHARACTER_SELECT_QUERY,

        {character_id: config.characterId}, jar, 'character');

      if (!changed.rev2ChangeCharacter) throw new ApiError('CHARACTER_SELECT_REJECTED',

        '指定キャラクターへの切り替えが成立しませんでした。', 'character');

      // Verify the actual selected character; a truthy mutation result alone is not sufficient.

      const selected = await gql('GetMe', ME_QUERY, {}, jar, 'character');

      if (selected.rev2Me?.current_character?.character_id !== config.characterId)

        throw new ApiError('CHARACTER_VERIFY_FAILED', '切り替え後のキャラクターを確認できませんでした。', 'character');

      steps.push({stage: 'character', ok: true});

      state.session = {jar, createdAt: now()};

      state.cooldownUntil = 0;

      return state.session;

    } catch (error) {

      state.session = null;

      state.cooldownUntil = now() + LOGIN_COOLDOWN_MS;

      throw error;

    }

  }

  async function decode(code, config, steps) {

    const fingerprint = Array.from(await digest(JSON.stringify(config))).join(',');

    if (state.fingerprint !== fingerprint) {

      state.fingerprint = fingerprint;

      state.session = null;

      state.cooldownUntil = 0;

    }

    if (state.session && (now() - state.session.createdAt >= SESSION_TTL_MS || !state.session.jar.header()))

      state.session = null;

    let session = state.session;

    if (session) steps.push({stage: 'session_reuse', ok: true});

    else session = await authenticate(config, steps);

    for (let attempt = 0; attempt < 2; attempt++) {

      try {

        const result = await gql('DecodeArenaSettings', DECODE_QUERY, {password: code}, session.jar, 'decode');

        const actions = checkedActions(result.rev2ArenaSettingsDecode);

        steps.push({stage: 'decode', ok: true});

        return actions;

      } catch (error) {

        // Retry only an explicit login-required error, at most once. Never loop on invalid codes/403.

        if (error?.code !== 'SESSION_REQUIRED' || attempt !== 0) {

          if (error?.code === 'SESSION_REQUIRED') state.session = null;

          throw error;

        }

        state.session = null;

        steps.push({stage: 'reauthenticate', ok: true});

        session = await authenticate(config, steps);

      }

    }

  }

  async function checkPublicLimit(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.ARENA_RATE_LIMITER?.limit) {
      const result = await env.ARENA_RATE_LIMITER.limit({ key: 'arena:' + ip });
      if (!result.success) throw new ApiError('RATE_LIMITED', '共有AIの取得回数が多すぎます。時間をおいてお試しください。', 'rate_limit', 429);
      return;
    }
    // Per-isolate fallback, not a globally enforced security boundary.
    const time = now();
    const previous = state.publicHits.get(ip);
    if (!previous || time - previous.since >= FALLBACK_WINDOW_MS) {
      if (state.publicHits.size >= FALLBACK_MAX_IPS) state.publicHits.clear();
      state.publicHits.set(ip, { since: time, count: 1 });
      return;
    }
    if (previous.count >= FALLBACK_LIMIT) throw new ApiError('RATE_LIMITED', '共有AIの取得回数が多すぎます。時間をおいてお試しください。', 'rate_limit', 429);
    previous.count++;
  }

  async function publicCharacter(request, responseHeaders) {

    let id;

    try { id = parseURL((await readLimited(request, 2000)).url); }

    catch { return json({error: '公式サイトのキャラクター詳細URLをJSON形式で指定してください（2000バイト以内）。'}, 400, responseHeaders); }

    try {

      // No authenticated session or incoming cookies are ever used on this route.

      const upstream = await fetchImpl(`${OFFICIAL_ORIGIN}/graphql?opname=GetCharacterDetail`, {

        method: 'POST', headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},

        body: JSON.stringify({operationName: 'GetCharacterDetail', query: CHARACTER_QUERY, variables: {character_id: id}}),

        redirect: 'manual', signal: AbortSignal.timeout(20000)

      });

      if (!upstream.ok) return json({error: upstream.status === 429 ?

        '公式サイトが混み合っています。時間をおいて再試行してください。' :

        `公式サイトから取得できませんでした（HTTP ${upstream.status}）。`}, 502, responseHeaders);

      if (!upstream.headers.get('Content-Type')?.toLowerCase().includes('json'))

        return json({error: '公式サイトからJSONが返りませんでした。'}, 502, responseHeaders);

      const data = await readLimited(upstream, MAX_UPSTREAM_BYTES);

      if (data?.data?.character?.character_id !== id)

        return json({error: 'キャラクターが非公開または見つかりません。'}, 404, responseHeaders);

      return json(data, 200, responseHeaders);

    } catch (error) { return json({error: error?.name === 'TimeoutError' ?

      '公式サイトとの通信がタイムアウトしました。' : '公式サイトの通信が失敗しました。時間をおいて再試行してください。'}, 502, responseHeaders); }

  }

  return {

    async fetch(request, env = {}) {

      const url = new URL(request.url), origin = request.headers.get('Origin') || '';

      if (url.pathname === '/arena-test' && request.method === 'GET') return testPage();

      const arenaPublic = url.pathname === '/arena/decode';
      const arenaAdmin = url.pathname === '/arena/admin/decode';
      const arena = arenaPublic || arenaAdmin;

      if (url.pathname !== '/character' && !arena) return json({error: 'ページが見つかりません。'}, 404);

      // The public endpoint is open to all on the allowed site; the admin endpoint requires a key.

      const permitted = arena ? (!origin || origin === url.origin || ALLOWED_ORIGINS.has(origin)) : ALLOWED_ORIGINS.has(origin);

      if (!permitted) return json({error: 'この公開サイトからの取得は許可されていません。'}, 403);

      const responseHeaders = origin ? cors(origin, arena) : {};

      if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: responseHeaders});

      if (request.method !== 'POST') return json({error: 'POST専用です。'}, 405, {...responseHeaders, Allow: 'POST, OPTIONS'});

      if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json'))

        return json({error: 'JSON形式で送信してください。'}, 415, responseHeaders);

      if (!arena) return publicCharacter(request, responseHeaders);

      if (arenaAdmin && (typeof env.ARENA_ADMIN_TOKEN !== 'string' || env.ARENA_ADMIN_TOKEN.length < 32))

        return json({ok: false, code: 'ADMIN_KEY_MISSING', stage: 'configuration',

          error: '32文字以上のARENA_ADMIN_TOKENをCloudflareのSecretに設定してください。'}, 503, responseHeaders);

      const auth = request.headers.get('Authorization') || '';

      if (arenaAdmin && (auth.length > 1100 || !auth.startsWith('Bearer ') ||

          !await equalSecret(auth.slice(7), env.ARENA_ADMIN_TOKEN)))

        return json({ok: false, code: 'ADMIN_KEY_INVALID', stage: 'access',

          error: '管理用テストキーが一致しません。公式サイトのパスワードではありません。'}, 401, responseHeaders);

      let code, config;

      try {

        const payload = await readLimited(request, 2000);

        code = typeof payload?.code === 'string' ? payload.code.trim() : '';

        if (!/^[a-z0-9]{1,64}$/i.test(code)) throw Error('INVALID_CODE');

      } catch { return json({ok: false, code: 'INVALID_INPUT', stage: 'input',

        error: '半角英数字の共有コードを指定してください（64文字以内、入力2000バイト以内）。'}, 400, responseHeaders); }

      try {
        if (arenaPublic) await checkPublicLimit(request, env);
        config = configuration(env);
      }

      catch (error) {
        const known = error instanceof ApiError;
        return json({ok: false,
          code: known ? error.code : 'RATE_LIMIT_SERVICE_ERROR',
          stage: known ? error.stage : 'rate_limit',
          error: known ? error.message : '取得制限を確認できませんでした。時間をおいてお試しください。'},
          known ? error.status : 503, responseHeaders);
      }

      const steps = [];

      try {

        const actions = await serial(() => decode(code, config, steps));

        return json(arenaAdmin
          ? {ok: true, ruleCount: actions.length, characterId: config.characterId, steps, data: {rev2ArenaSettingsDecode: actions}}
          : {ok: true, ruleCount: actions.length, data: {rev2ArenaSettingsDecode: actions}},
          200, responseHeaders);

      } catch (error) {

        const known = error instanceof ApiError;

        return json({ok: false, code: known ? error.code : 'INTERNAL_ERROR',

          stage: known ? error.stage : 'internal',

          error: known ? error.message : 'Worker内で処理に失敗しました。', steps},

          known ? error.status : 500, responseHeaders);

      }

    }

  };

}



function testPage() {

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');

  const html = `<!doctype html><html lang="ja"><meta charset="utf-8">

<meta name="viewport" content="width=device-width,initial-scale=1"><title>Battle Lab｜共有AIの接続確認</title>

<style nonce="${nonce}">

*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#182b3b;font:16px/1.7 system-ui,sans-serif}

main{max-width:680px;margin:44px auto;padding:28px;background:#fff;border:1px solid #d9e1e8;border-radius:14px}

.tag{font-size:12px;letter-spacing:.08em;color:#597084}h1{font-size:24px;line-height:1.4;margin:8px 0 20px}

label{display:block;font-weight:650;margin:20px 0 5px}input{width:100%;font:inherit;padding:10px 12px;border:1px solid #bbc9d4;border-radius:7px}

button{font:inherit;cursor:pointer;padding:11px 18px;background:#146858;border:0;border-radius:7px;color:white;margin-top:22px}

button:disabled{opacity:.5;cursor:wait}.small{font-size:13px;color:#526778}#result{white-space:pre-wrap;margin-top:22px;padding:15px;background:#f1f5f7;border-radius:8px}

#result:empty{display:none}#steps{padding-left:23px}.bad{color:#a72c27}code{font-size:13px}footer{margin-top:24px;border-top:1px solid #e0e5eb;padding-top:12px}

@media(max-width:720px){main{margin:16px;padding:22px}h1{font-size:21px}}

</style>

<main><div class="tag">BATTLE LAB · 管理者用接続確認</div><h1>共有コードからAIを取得</h1>

<p>公式ログインとキャラクター選択をWorker側で行い、共有AIを取得できるか確認します。</p>

<p class="small">公式のメールアドレス・パスワードはCloudflareのSecretに設定します。このページには入力しません。</p>

<label for="key">管理用テストキー</label><input id="key" type="password" autocomplete="off" spellcheck="false" maxlength="1024" placeholder="ARENA_ADMIN_TOKEN に設定した値">

<label for="code">共有コード</label><input id="code" value="a0teowebglgn68" autocomplete="off" spellcheck="false" maxlength="64">

<button id="run" type="button">接続確認とAI取得</button><div id="result" role="status" aria-live="polite"></div><ol id="steps"></ol>

<footer class="small">キーはこのページ内だけで使用し、保存しません。ログイン・キャラクター切替・AI取得の結果が表示されます。JSONの貼り付けや拡張機能は不要です。</footer></main>

<script nonce="${nonce}">

const $=id=>document.getElementById(id);

const names={configuration:'Secret設定',access:'管理キー',input:'共有コード',login:'公式ログイン',session:'セッション・所有キャラクター確認',character:'キャラクター選択の確認',decode:'共有AI取得',session_reuse:'保持中のセッションを再利用',reauthenticate:'セッション切れのため再認証',internal:'内部処理'};

$('run').addEventListener('click',async()=>{

  const key=$('key').value,code=$('code').value.trim();

  if(key.length<32){$('result').textContent='Cloudflareに設定した32文字以上の管理用テストキーを入力してください。';return;}

  if(!/^[a-z0-9]{1,64}$/i.test(code)){$('result').textContent='半角英数字の共有コードを入力してください。';return;}

  $('run').disabled=true;$('result').className='';$('result').textContent='確認中です。完了までお待ちください。';$('steps').replaceChildren();

  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);

  try{

    const response=await fetch('/arena/decode',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({code}),signal:controller.signal});

    const data=await response.json();

    for(const step of data.steps||[]){const li=document.createElement('li');li.textContent=(names[step.stage]||step.stage)+'：完了';$('steps').appendChild(li);}

    if(data.ok){$('result').textContent='取得成功：'+data.ruleCount+'件のAI戦術を取得しました。\nキャラクター：'+data.characterId;}

    else{$('result').className='bad';$('result').textContent='確認箇所：'+(names[data.stage]||data.stage||'通信')+'\n'+(data.error||'取得できませんでした。')+'\n確認用コード：'+(data.code||response.status);}

  }catch(error){$('result').className='bad';$('result').textContent=error.name==='AbortError'?'通信がタイムアウトしました。時間をおいて再試行してください。':'Workerの応答を読み込めませんでした。デプロイ先の /arena-test を開いているか確認してください。';}

  finally{clearTimeout(timer);$('run').disabled=false;}

});

</script></html>`;

  return new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8',

    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',

    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`}});

}

export default createWorker();
