// Runs on official arena only. Same-origin POST; never reads or sends cookies.
if (new URLSearchParams(location.hash.slice(1)).has('bl_code')) {
  const panel = document.createElement('div');
  Object.assign(panel.style, {position:'fixed',top:'12px',right:'12px',zIndex:'2147483647',
    background:'#172434',color:'#fff',padding:'12px',borderRadius:'9px',
    boxShadow:'0 3px 15px #0006',maxWidth:'320px',font:'14px/1.5 sans-serif'});
  const label = document.createElement('p');
  label.textContent = '公式アリーナの共有AIを送信先 ' + (new URLSearchParams(location.hash.slice(1)).get('bl_origin') || '不明') + ' に転送します。ご自身のBattle Labのタブか確認してからボタンを押してください。';
  const button = document.createElement('button');
  button.type='button'; button.textContent='Battle LabへAIを送る';
  Object.assign(button.style,{background:'#7dbdff',color:'#102031',padding:'8px',cursor:'pointer',border:'none',borderRadius:'5px'});
  button.addEventListener('click',()=>{button.disabled=true;void (async function runOfficialArenaRelay(graphqlQuery) {
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
})("query DecodeArenaSettings($password: String!) {\n  rev2ArenaSettingsDecode(password: $password) {\n    active\n    conditions { subject params { character_id condition_type param1 param2 bs_list negate } }\n    maneuver { maneuver skill_id auto_position move_mode move_target { target params { character_id condition_type param1 param2 bs_list negate } } move_priority dist_min dist_max }\n    target { target params { character_id condition_type param1 param2 bs_list negate } }\n  }\n}");});
  panel.append(label, button);
  (document.body||document.documentElement).appendChild(panel);
}
