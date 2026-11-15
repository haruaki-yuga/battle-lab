// Battle Lab: submit voluntary bug reports to the configured Formspree endpoint.
// No character config, AI rules or battle logs are collected or sent.
const dialog = document.getElementById('bug-report-dialog');
const form = document.getElementById('bug-report-form');
const status = document.getElementById('bug-report-status');
const submit = form?.querySelector('[type="submit"]');
let sending = false;

function showStatus(message, kind = '') {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
}

function closeReport() {
    if (sending) return;
    dialog?.close();
}

document.getElementById('bug-report-close')?.addEventListener('click', closeReport);
document.getElementById('bug-report-cancel')?.addEventListener('click', closeReport);
dialog?.addEventListener('cancel', event => {
    if (sending) event.preventDefault();
});

dialog?.addEventListener('close', () => {
    if (status?.dataset.kind !== 'success') return;
    form?.reset();
    showStatus('');
});

form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;

    // One click = one request. A failed request preserves the entered report.
    sending = true;
    submit.disabled = true;
    submit.textContent = '送信中…';
    form.setAttribute('aria-busy', 'true');
    showStatus('送信しています…');

    const data = new FormData(form);
    data.set('browser_info', navigator.userAgent || 'unknown');
    data.set('reported_at', new Date().toISOString());
    try {
        const response = await fetch(form.action, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: data
        });
        if (!response.ok) {
            if (response.status === 429) throw new Error('送信回数の上限に達しました。少し時間を置いてから再送してください。');
            const details = await response.json().catch(() => null);
            const errorText = details?.errors?.map(item => item.message).filter(Boolean).join(' / ');
            throw new Error(errorText || `送信できませんでした（HTTP ${response.status}）。時間を置いて再試行してください。`);
        }
        showStatus('不具合報告を受け付けました。ご協力ありがとうございます。', 'success');
        form.reset();
    } catch (error) {
        showStatus(error.message || '通信に失敗しました。接続を確認して再試行してください。', 'error');
    } finally {
        sending = false;
        submit.disabled = false;
        submit.textContent = '報告を送信';
        form.removeAttribute('aria-busy');
    }
});
