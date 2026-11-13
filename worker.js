import { runBatch } from './batch.js';
self.onmessage = ({ data: { config, n } }) => {
    try {
        self.postMessage(runBatch(config, n, progress => self.postMessage({ progress })));
    }
    catch (e) {
        self.postMessage({ error: e.message });
    }
};
