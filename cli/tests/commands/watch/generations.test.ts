import fs from 'fs';
import path from 'path';
import os from 'os';
import { decideStall, Backoff, beginGeneration, activeGeneration, resolveGeneration, enterCustody, launchControllerGeneration, controllerGenerationHasUnresolvedClaim, ensureControllerGeneration } from '../../../src/commands/watch/generations';
import { adapterFor } from '../../../src/core/journal/adapter';
import { spawnStructured } from '../../../src/core/journal/process';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { logsDir } from '../../../src/core/journal/paths';
import { claimPath, resultPath } from '../../../src/commands/job/exec-wrapper';

describe('generaciones', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-gen-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('decideStall: heartbeat vencido solo => observar, nunca kill (R4.2)', () => {  // verifies R4.2
        const cfg = { heartbeatTimeoutMs: 5 * 60000, activityWindowMs: 10 * 60000 };
        expect(decideStall({ heartbeatAgeMs: 60000, activityFrozenMs: 0, safeToReplace: 'indeterminate' }, cfg)).toBe('healthy');
        expect(decideStall({ heartbeatAgeMs: 10 * 60000, activityFrozenMs: 0, safeToReplace: 'indeterminate' }, cfg)).toBe('suspected-stall-observe');
        // doble senial + adapter indeterminate => custodia BLOCKED, sin matar (R4.2b)
        expect(decideStall({ heartbeatAgeMs: 20 * 60000, activityFrozenMs: 15 * 60000, safeToReplace: 'indeterminate' }, cfg)).toBe('custody-blocked');
        // doble senial + safe positivo => recien ahi resolver la generacion
        expect(decideStall({ heartbeatAgeMs: 20 * 60000, activityFrozenMs: 15 * 60000, safeToReplace: 'safe' }, cfg)).toBe('resolve-generation');
    });

    test('backoff 1->5->15 con techo y tope por hora (R4.3)', () => {       // verifies R4.3
        const b = new Backoff();
        expect(b.nextMs()).toBe(60000);
        expect(b.nextMs()).toBe(300000);
        expect(b.nextMs()).toBe(900000);
        expect(b.nextMs()).toBe(900000);   // techo
        expect(b.exhausted()).toBe(false);
        for (let i = 0; i < 6; i++) b.recordRelaunch();
        expect(b.exhausted()).toBe(true);
    });

    test('beginGeneration hace fencing: la anterior queda superseded (R1.7)', () => {  // verifies R1.7
        const g1 = beginGeneration(repo, 'rama');
        const g2 = beginGeneration(repo, 'rama');
        expect(g2.n).toBe(2);
        expect(g2.token).not.toBe(g1.token);
        const s = readJournal(repo, 'rama').state!;
        expect(s.generations.find((g) => g.n === 1)!.state).toBe('superseded');
        expect(activeGeneration(s)!.n).toBe(2);
    });

    test('beginGeneration reinicia el heartbeat al cambiar el fencing token', () => {
        const s0 = readJournal(repo, 'rama').state!;
        s0.controllerHeartbeatAt = new Date().toISOString();
        writeJournal(repo, 'rama', s0);
        beginGeneration(repo, 'rama');
        expect(readJournal(repo, 'rama').state!.controllerHeartbeatAt).toBeUndefined();
    });

    test('el intent de launch queda durable y el prompt entrega el generation token al controller', () => {
        const begun = beginGeneration(repo, 'rama');
        let captured: { argv: string[]; nonce: string } | undefined;
        const wrapperRef = { pid: 42, startTime: 't', spawnNonce: 'wrapper-nonce', argvDigest: 'a', processGroup: 42, psArgsDigest: 'p' };
        launchControllerGeneration(repo, 'rama', 'codex', 'continua el ciclo', (job, nonce) => {
            const duringSpawn = activeGeneration(readJournal(repo, 'rama').state!)!;
            expect(duringSpawn.controllerJobId).toBe(job.id);       // persistido ANTES del spawn
            expect(duringSpawn.spawnNonce).toBe(nonce);
            captured = { argv: job.argv, nonce };
            return wrapperRef;
        });
        expect(captured!.argv.join(' ')).toContain(begun.token);
        expect(captured!.argv.join(' ')).toContain(`--generation ${begun.token}`);
        expect(activeGeneration(readJournal(repo, 'rama').state!)!.wrapperRef).toEqual(wrapperRef);
    });

    test('claim sin identidad/resultado conserva ownership ambiguo; usa la edad del claim, no la de begin', () => {
        beginGeneration(repo, 'rama');
        launchControllerGeneration(repo, 'rama', 'codex', 'continua', () => {});
        let s = readJournal(repo, 'rama').state!;
        const gen = activeGeneration(s)!;
        gen.launchedAt = new Date(Date.now() - 3600000).toISOString();
        writeJournal(repo, 'rama', s);
        fs.mkdirSync(logsDir(repo, 'rama'), { recursive: true });
        fs.writeFileSync(claimPath(logsDir(repo, 'rama'), gen.controllerJobId!, gen.spawnNonce!), '{}');
        expect(controllerGenerationHasUnresolvedClaim(repo, 'rama', gen)).toBe(true);
        ensureControllerGeneration(repo, 'rama', 'codex', 'continua', () => {}, 10000);
        expect(readJournal(repo, 'rama').state!.cycle.status).toBe('IN_PROGRESS'); // claim recien creado: aun dentro de gracia
        const old = new Date(Date.now() - 20000);
        fs.utimesSync(claimPath(logsDir(repo, 'rama'), gen.controllerJobId!, gen.spawnNonce!), old, old);
        ensureControllerGeneration(repo, 'rama', 'codex', 'continua', () => {}, 10000);
        expect(readJournal(repo, 'rama').state!.cycle.status).toBe('BLOCKED');
        fs.writeFileSync(resultPath(logsDir(repo, 'rama'), gen.controllerJobId!, gen.spawnNonce!), JSON.stringify({ exitCode: 1 }));
        expect(controllerGenerationHasUnresolvedClaim(repo, 'rama', gen)).toBe(false);
    });

    test('resolveGeneration: muerte probada => proven-dead; vivo+indeterminate => custodia con estado BLOCKED (R4.2b)', async () => {  // verifies R4.2b
        const adapter = adapterFor('codex');
        beginGeneration(repo, 'rama');
        let s = readJournal(repo, 'rama').state!;
        const gen = activeGeneration(s)!;
        gen.processRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        writeJournal(repo, 'rama', s);
        expect(await resolveGeneration(repo, 'rama', adapter, { termGraceMs: 100, killGraceMs: 100 })).toBe('proven-dead');
        // vivo: el adapter codex no puede afirmar safeToReplace => custodia SIN matar
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 8000)'], process.cwd(), 'nG');
        s = readJournal(repo, 'rama').state!;
        activeGeneration(s)!.processRef = ref;
        writeJournal(repo, 'rama', s);
        expect(await resolveGeneration(repo, 'rama', adapter, { termGraceMs: 100, killGraceMs: 100 })).toBe('custody-blocked');
        const after = readJournal(repo, 'rama').state!;
        expect(after.cycle.status).toBe('BLOCKED');
        expect(after.cycle.blockedReason).toMatch(/safeToReplace/);
        expect(child.killed).toBe(false);                       // JAMAS se toco al vivo
        child.kill('SIGKILL');
    });

    test('enterCustody deja razon auditada y ciclo BLOCKED (R4.5)', () => {  // verifies R4.5
        enterCustody(repo, 'rama', 'prueba de custodia');
        const s = readJournal(repo, 'rama').state!;
        expect(s.cycle.status).toBe('BLOCKED');
        expect(s.cycle.blockedReason).toBe('prueba de custodia');
    });
});
