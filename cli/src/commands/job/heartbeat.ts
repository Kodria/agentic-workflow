import crypto from 'crypto';
import { emitRequest } from '../../core/journal/requests';

export function emitHeartbeat(repoRoot: string, branch: string, generationToken: string): void {
    emitRequest(repoRoot, branch, {
        kind: 'controller-heartbeat', generationToken,
        idempotencyKey: crypto.randomBytes(8).toString('hex'),   // cada latido es unico
        payload: { at: new Date().toISOString() },
    });
}
