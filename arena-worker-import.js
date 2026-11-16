// Battle Lab -> owner-operated Cloudflare Worker -> official authenticated Arena API.
// No admin token is used on the public endpoint. Official credentials remain in Worker Secrets.
import { validateArenaShareCode, extractSharedArenaActions } from './arena-share-import.js?v=1.17.16';

export function normalizeArenaWorkerUrl(input) {
    let url;
    try { url = new URL(String(input ?? '').trim()); }
    catch { throw Error('Cloudflare WorkerのURLを入力してください。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.workers\.dev$/i.test(url.hostname)) {
        throw Error('HTTPSのCloudflare Workers（*.workers.dev）URLを指定してください。');
    }
    if (!['/', '/arena-test', '/arena/decode'].includes(url.pathname) || url.search || url.hash)
        throw Error('WorkerのトップURLか /arena-test のURLを指定してください。');
    return url.origin;
}

export async function fetchArenaSharedAiViaWorker(value, {
    workerUrl, fetchImpl = fetch, signal
} = {}) {
    const code = validateArenaShareCode(value);
    const origin = normalizeArenaWorkerUrl(workerUrl);
    let response;
    try {
        response = await fetchImpl(origin + '/arena/decode', {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({code}),
            signal
        });
    } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw Error('共有AI取得がタイムアウトしました。');
        throw Error('Workerとの通信が失敗しました。WorkerのURL・デプロイ・CORS許可を確認してください。');
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw Error('WorkerからJSON形式の応答を受け取れませんでした。'); }
    if (!response.ok || payload?.ok !== true) {
        const desc = typeof payload?.error === 'string' ? payload.error.slice(0, 300) :
            '共有AIを取得できませんでした。';
        const stage = typeof payload?.stage === 'string' ? `（${payload.stage.slice(0, 40)}）` : '';
        throw Error(`${desc}${stage}`);
    }
    return extractSharedArenaActions(payload);
}
