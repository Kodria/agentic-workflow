// cli/src/core/update-check-worker.ts
//
// Proceso detached lanzado por maybeNotifyUpdate: refresca el cache y muere.
import { fetchLatestVersion, writeUpdateCache } from './update-check';

(async () => {
    const latest = await fetchLatestVersion();
    writeUpdateCache({ lastCheck: Date.now(), latest });
})();
