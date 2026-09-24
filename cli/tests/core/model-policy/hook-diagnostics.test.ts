import fs from 'fs';
import os from 'os';
import path from 'path';
import { readRoutingHookStatus, recordRoutingHookStatus } from '../../../src/core/model-policy/hook-diagnostics';

describe('durable Claude hook diagnostics', () => {
    it('alerts once per unresolved cause and retains a named failure until native capture recovers', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-hook-diagnostic-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        try {
            expect(readRoutingHookStatus()).toEqual({ state: 'absent' });
            expect(recordRoutingHookStatus('stop', 'HOOK_TRANSCRIPT_UNVERIFIED', new Date('2026-09-23T01:00:00.000Z'))).toBe(true);
            expect(recordRoutingHookStatus('stop', 'HOOK_TRANSCRIPT_UNVERIFIED', new Date('2026-09-23T01:01:00.000Z'))).toBe(false);
            expect(readRoutingHookStatus()).toEqual({ state: 'failed', failures: [{ phase: 'stop', reasonCode: 'HOOK_TRANSCRIPT_UNVERIFIED', count: 2 }] });
            expect(recordRoutingHookStatus('stop', 'success', new Date('2026-09-23T01:02:00.000Z'))).toBe(false);
            expect(readRoutingHookStatus()).toEqual({ state: 'healthy' });
            const file = path.join(root, 'routing-hook-status.json');
            fs.writeFileSync(file, '{"schema":"routing-hook-status/v1","start":{},"stop":{}}');
            expect(readRoutingHookStatus()).toEqual({ state: 'invalid' });
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
});
