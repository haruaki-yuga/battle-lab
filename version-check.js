// Battle Lab update notification (static-hosting friendly).
// Increase CURRENT_VERSION and version.json together for each release.
const CURRENT_VERSION = '1.18.15';
const CHECK_INTERVAL_MS = 60_000;
const REMIND_AFTER_MS = 30 * 60_000;

const notice = document.getElementById('update-notice');
const latestLabel = document.getElementById('update-notice-versions');
const laterButton = document.getElementById('update-notice-later');
const reloadButton = document.getElementById('update-notice-reload');
let latestAvailable = null;
let lastDismissedAt = 0;
let checking = false;
let lastCheckedAt = 0;

// Use numerical version comparison, not lexicographic order (1.17.160 > 1.17.16).
function versionParts(version) {
    if (typeof version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(version)) return null;
    return version.split('.').map(Number);
}
function newerVersion(remote, current) {
    const remoteParts = versionParts(remote), currentParts = versionParts(current);
    if (!remoteParts || !currentParts) return false;
    for (let i = 0; i < Math.max(remoteParts.length, currentParts.length); i++) {
        const delta = (remoteParts[i] || 0) - (currentParts[i] || 0);
        if (delta) return delta > 0;
    }
    return false;
}

function maybeShowNotice() {
    if (!latestAvailable || notice?.open) return;
    if (lastDismissedAt && Date.now() - lastDismissedAt < REMIND_AFTER_MS) return;
    if (latestLabel) latestLabel.textContent = `現在 v${CURRENT_VERSION} ／ 最新 v${latestAvailable}`;
    notice?.showModal();
}

async function checkForUpdate() {
    // Local file:// deployments cannot reliably fetch the manifest; never display false alerts.
    if (!['http:', 'https:'].includes(location.protocol) || document.hidden || checking) return;
    checking = true;
    lastCheckedAt = Date.now();
    try {
        const manifestURL = new URL('version.json', document.baseURI);
        manifestURL.searchParams.set('_update_check', String(Date.now()));
        const response = await fetch(manifestURL.href, { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) return;
        const manifest = await response.json();
        const version = manifest?.version;
        if (!newerVersion(version, CURRENT_VERSION)) return;
        if (version !== latestAvailable) lastDismissedAt = 0;
        latestAvailable = version;
        maybeShowNotice();
    } catch {
        // Offline or temporarily unavailable servers: retry at the next interval.
    } finally {
        checking = false;
    }
}

laterButton?.addEventListener('click', () => {
    lastDismissedAt = Date.now();
    notice?.close();
});
notice?.addEventListener('close', () => {
    // Includes dismissing the dialog with Escape.
    if (!lastDismissedAt) lastDismissedAt = Date.now();
});
reloadButton?.addEventListener('click', () => {
    // A query parameter makes the reloaded index.html a fresh URL even on cache-heavy hosts.
    const next = new URL(location.href);
    if (latestAvailable) next.searchParams.set('_bl_version', latestAvailable);
    location.assign(next.href);
});

if (['http:', 'https:'].includes(location.protocol)) {
    // Check on launch, once a minute, and after returning to a backgrounded tab.
    void checkForUpdate();
    setInterval(() => { void checkForUpdate(); }, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastCheckedAt > 10_000) void checkForUpdate();
    });
    window.addEventListener('online', () => { void checkForUpdate(); });
}
