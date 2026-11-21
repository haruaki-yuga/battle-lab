// In-page replacement for browser confirm(): no popup permission required.
// Requests are queued so overlapping actions cannot reuse the same dialog.
const requests = [];
let showing = false;

function nextConfirmation() {
    if (showing || requests.length === 0) return;
    showing = true;
    const {message, title, acceptText, resolve} = requests[0];
    const dialog = document.getElementById('app-confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
        showing = false; requests.shift(); resolve(false); nextConfirmation();
        return;
    }
    dialog.querySelector('[data-confirm-message]').textContent = String(message);
    dialog.querySelector('[data-confirm-title]').textContent = title;
    dialog.querySelector('[data-confirm-accept]').textContent = acceptText;
    dialog.returnValue = 'cancel';
    const onClose = () => {
        const accepted = dialog.returnValue === 'confirm';
        dialog.removeEventListener('close', onClose);
        requests.shift(); showing = false;
        resolve(accepted);
        nextConfirmation();
    };
    dialog.addEventListener('close', onClose);
    try { dialog.showModal(); }
    catch {
        dialog.removeEventListener('close', onClose);
        requests.shift(); showing = false; resolve(false); nextConfirmation();
    }
}

export function confirmInApp(message, {title = '操作の確認', acceptText = '続行する'} = {}) {
    return new Promise(resolve => {
        requests.push({message, title, acceptText, resolve});
        nextConfirmation();
    });
}
