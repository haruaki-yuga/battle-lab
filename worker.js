import { runBatch } from './batch.js?v=1.18.21&dialogueui=1';
self.onmessage = ({ data: { config, n } }) => {
    try {
        self.postMessage(runBatch(config, n, progress => self.postMessage({ progress })));
    }
    catch (e) {
        self.postMessage({ error: e.message });
    }
};
