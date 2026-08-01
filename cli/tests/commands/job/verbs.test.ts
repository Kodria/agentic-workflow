import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { requestJob } from '../../../src/commands/job/request';
import { emitHeartbeat } from '../../../src/commands/job/heartbeat';
import { queryPs, queryList, queryShow } from '../../../src/commands/job/query';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { statePath } from '../../../src/core/journal/paths';
import { listPendingRequests } from '../../../src/core/journal/requests';

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

describe('job verbs', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-verbs-')); gitInit(repo); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('requestJob emite request con get-or-create key = hash(fingerprint+cmd) y cwd real (R3.1)', () => {  // verifies R3.1
        const a = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], [], '.');
        const b = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], [], '.');
        expect(a.idempotencyKey).toBe(b.idempotencyKey);      // mismo fingerprint+cmd => misma key (RNF-T.7)
        fs.mkdirSync(path.join(repo, 'otro-cwd-logico'));
        const c = requestJob(repo, 'rama', 'gen-1', ['npm', 'test'], [], 'otro-cwd-logico');
        expect(c.idempotencyKey).not.toBe(a.idempotencyKey);  // cwd distinto => key distinta (R3.4)
        expect(listPendingRequests(repo, 'rama').length).toBe(3);  // el supervisor colapsa por key
    });

    test('emitHeartbeat publica request de heartbeat (R3.5)', () => {      // verifies R3.5
        emitHeartbeat(repo, 'rama', 'gen-1');
        const pending = listPendingRequests(repo, 'rama');
        expect(pending.some((p) => !p.corrupt && p.envelope.kind === 'controller-heartbeat')).toBe(true);
    });

    test('queryPs/list/show reportan corrupt visible, no lo descartan (R1.6)', () => {  // verifies R1.6
        const s = readJournal(repo, 'rama').state!;
        s.jobs['j1'] = {
            id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
            paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing', phaseTimestamps: {},
        };
        writeJournal(repo, 'rama', s);
        expect(queryPs(repo, 'rama').corruptState).toBe(false);
        expect(queryList(repo, 'rama').jobs).toHaveLength(1);
        expect(queryShow(repo, 'rama', 'j1').job!.id).toBe('j1');
        expect(queryShow(repo, 'rama', 'no-existe').job).toBeNull();
        fs.writeFileSync(statePath(repo, 'rama'), '{roto');
        expect(queryPs(repo, 'rama').corruptState).toBe(true);
        expect(queryList(repo, 'rama').corruptState).toBe(true);
        expect(queryShow(repo, 'rama', 'j1').corruptState).toBe(true);
    });
});
