// First-party-tab relay for official Arena share codes.
// No login cookies, headers or credentials are transferred to Battle Lab.
import { DECODER_QUERY, validateArenaShareCode } from './arena-share-import.js?v=1.17.14';

export const ARENA_ORIGIN = 'https://rev2.reversion.jp';
export const BRIDGE_MESSAGE_TYPE = 'battle-lab-arena-share-v1';
export const BRIDGE_HASH_KEYS = Object.freeze({ code: 'bl_code', nonce: 'bl_nonce', origin: 'bl_origin' });

export function newBridgeNonce(cryptoImpl = globalThis.crypto) {
    if (!cryptoImpl?.getRandomValues) throw Error('安全な連携トークンを生成できません。HTTPSでBattle Labを開いてください。');
    const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function officialTabUrl(value, nonce, senderOrigin) {
    const code = validateArenaShareCode(value);
    if (!/^[a-f0-9]{32}$/.test(nonce)) throw Error('連携トークンが不正です。');
    if (!senderOrigin || (!/^https?:\/\//.test(senderOrigin) && senderOrigin !== 'null'))
        throw Error('連携元のアドレスが不正です。');
    const url = new URL('/arena', ARENA_ORIGIN);
    url.hash = new URLSearchParams({
        [BRIDGE_HASH_KEYS.code]: code,
        [BRIDGE_HASH_KEYS.nonce]: nonce,
        [BRIDGE_HASH_KEYS.origin]: senderOrigin
    }).toString();
    return url.href;
}

export function isOfficialBridgeEvent(event, expected) {
    const message = event?.data;
    return event?.origin === ARENA_ORIGIN &&
        event?.source === expected?.popup &&
        message?.type === BRIDGE_MESSAGE_TYPE && message?.version === 1 &&
        message?.nonce === expected?.nonce && message?.code === expected?.code;
}

// This function has no free variables so it can be packaged both as a bookmarklet
// and as the content script in the optional Chrome/Edge extension.
export async function runOfficialArenaRelay(graphqlQuery) {
    const ORIGIN = 'https://rev2.reversion.jp';
    const TYPE = 'battle-lab-arena-share-v1';
    if (location.origin !== ORIGIN) {
        alert('この連携は公式アリーナ（rev2.reversion.jp）で実行してください。');
        return;
    }
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const code = p.get('bl_code'), nonce = p.get('bl_nonce'), target = p.get('bl_origin');
    if (!code || !nonce || !target || !/^[0-9a-z]{1,64}$/i.test(code) ||
        !/^[0-9a-f]{32}$/.test(nonce) ||
        !(target === 'null' || /^https?:\/\/[^\s/?#]+$/i.test(target))) {
        alert('Battle Labで「公式タブで取得」を押して開いたタブから実行してください。');
        return;
    }
    function notice(message, failed = false) {
        let box = document.getElementById('battle-lab-arena-relay-status');
        if (!box) {
            box = document.createElement('div');
            box.id = 'battle-lab-arena-relay-status';
            Object.assign(box.style, {position:'fixed',top:'12px',right:'12px',zIndex:'2147483647',
                maxWidth:'360px',padding:'14px',background:'#172434',color:'#fff',
                font:'14px/1.6 sans-serif',borderRadius:'10px',boxShadow:'0 3px 15px #0006'});
            (document.body || document.documentElement).appendChild(box);
        }
        box.style.borderLeft = `5px solid ${failed ? '#e96b61' : '#78b6ff'}`;
        box.textContent = `Battle Lab連携：${message}`;
    }
    if (!window.opener || window.opener.closed) {
        notice('元のBattle Labタブに接続できません。Battle Labから公式タブを開き直してください。', true);
        return;
    }
    const send = packet => {
        // The origin is encoded by Battle Lab into this popup's URL and the
        // receiving window additionally checks source, origin and a random nonce.
        window.opener.postMessage({type:TYPE,version:1,code,nonce,...packet}, target === 'null' ? '*' : target);
    };
    notice('公式ログイン状態で共有AIを取得しています…');
    try {
        const response = await fetch('/graphql?opname=DecodeArenaSettings', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
            body: JSON.stringify({operationName:'DecodeArenaSettings',variables:{password:code},query:graphqlQuery})
        });
        if (!response.ok) throw Error(`公式APIの応答：HTTP ${response.status}`);
        const payload = await response.json();
        if (Array.isArray(payload?.errors) && payload.errors.length)
            throw Error(String(payload.errors[0]?.message || '公式APIでエラーが発生しました。').slice(0,240));
        if (!Array.isArray(payload?.data?.rev2ArenaSettingsDecode))
            throw Error('公式APIから共有AIを取得できませんでした。');
        if (JSON.stringify(payload).length > 1500000) throw Error('AIデータが大きすぎます。');
        send({payload});
        notice(`${payload.data.rev2ArenaSettingsDecode.length}件のAIをBattle Labへ送信しました。元のタブに戻ってください。`);
    } catch (error) {
        const message = error instanceof Error ? error.message : '通信に失敗しました。';
        send({error:message});
        notice(`${message}（キャラクターログインを確認し、必要ならこのタブを再読み込みしてください）`, true);
    }
}

export function officialBookmarkletHref() {
    // Drag the link to the bookmarks bar; the code is run only when clicked on
    // the official tab. Not an external script and does not copy cookie values.
    return `javascript:(${runOfficialArenaRelay.toString()})(${JSON.stringify(DECODER_QUERY)})`;
}
