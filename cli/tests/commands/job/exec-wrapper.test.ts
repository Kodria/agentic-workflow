import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExecWrapper, claimPath, identityPath, resultPath, replayVerdict, logPath } from '../../../src/commands/job/exec-wrapper';
import { groupIsGone } from '../../../src/core/journal/process';

// Real subprocess spawn + termination + fsync per test; the jest default of
// 5000ms proved too tight on a loaded windows-latest CI runner (regression:
// real CI, "Exceeded timeout of 5000 ms"). Same class of issue already fixed
// in registries-sync.test.ts this round.
jest.setTimeout(20000);

describe('exec-wrapper', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrap-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('claim + identity sidecar + resultado terminal atomico (R1.8)', async () => {  // verifies R1.8
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job1', nonce: 'nonceA', argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 300)'], cwd: '.' });
        expect(out.exitCode).toBe(0);
        expect(fs.existsSync(claimPath(dir, 'job1', 'nonceA'))).toBe(true);
        const identity = JSON.parse(fs.readFileSync(identityPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(identity.wrapper.pid).toBe(process.pid);            // ProcessRef REAL del wrapper
        expect(identity.command.pid).toBeGreaterThan(0);           // ProcessRef REAL del comando
        // hex real cuando la plataforma pudo observar el proceso (ps en
        // POSIX, WMI/powershell en win32 — ver captureRefFor en
        // src/core/journal/process.ts); sentinel 'unknown' documentado
        // cuando esa observacion no estuvo disponible (ps ausente, o en
        // win32 powershell/WMI restringido/deshabilitado). Mismo criterio
        // ya establecido en tests/core/journal/process.test.ts — el formato
        // exacto de este campo nunca es la fuente de verdad de vida/muerte
        // (esa es refIsAlive), asi que este test no puede exigir mas
        // certeza de la que la plataforma real puede dar.
        expect(identity.command.psArgsDigest).toMatch(/^([0-9a-f]{16}|unknown)$/);
        expect(identity.command.processGroup).not.toBe(identity.wrapper.processGroup);  // el wrapper puede limpiar el grupo sin matarse
        const result = JSON.parse(fs.readFileSync(resultPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(result.exitCode).toBe(0);
    });

    test('segundo claim con el mismo nonce falla: exactly-once (R1.8)', async () => {  // verifies R1.8
        await runExecWrapper({ logsRoot: dir, jobId: 'job2', nonce: 'nonceB', argv: ['node', '-e', 'process.exit(0)'], cwd: '.' });
        await expect(runExecWrapper({ logsRoot: dir, jobId: 'job2', nonce: 'nonceB', argv: ['node', '-e', 'process.exit(0)'], cwd: '.' }))
            .rejects.toThrow(/claim/);
    });

    test('comando inexistente produce resultado 127, no crash (R1.8)', async () => {  // verifies R1.8
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job3', nonce: 'nonceC', argv: ['binario-inexistente-xyz'], cwd: '.' });
        expect(out.exitCode).toBe(127);
        expect(replayVerdict(dir, 'job3', 'nonceC')).toBe('completed');
    });

    test('matriz de replay: sin claim / claim+resultado / claim sin resultado (R1.8)', async () => {  // verifies R1.8
        expect(replayVerdict(dir, 'jobX', 'n1')).toBe('never-started');       // sin claim => re-spawn seguro
        await runExecWrapper({ logsRoot: dir, jobId: 'jobY', nonce: 'n2', argv: ['node', '-e', 'process.exit(3)'], cwd: '.' });
        expect(replayVerdict(dir, 'jobY', 'n2')).toBe('completed');           // adoptar resultado
        fs.writeFileSync(claimPath(dir, 'jobZ', 'n3'), '{"claimed":true}');   // claim sin resultado
        expect(replayVerdict(dir, 'jobZ', 'n3')).toBe('unprovable');          // orphaned, jamas relanzar solo
    });

    test('el log captura la salida completa incluso si exit llega antes que el flush de stdio (R2.5)', async () => {  // verifies R2.5
        await runExecWrapper({ logsRoot: dir, jobId: 'job4', nonce: 'nonceD', argv: ['node', '-e', "process.stdout.write('linea-final-no-se-debe-perder'); process.exit(0)"], cwd: '.' });
        const log = fs.readFileSync(logPath(dir, 'job4', 'nonceD'), 'utf8');
        expect(log).toContain('linea-final-no-se-debe-perder');
    });

    test('redacta secretos aunque la asignacion llegue dividida entre chunks de stdout (R2.3)', async () => {
        const script = "process.stdout.write('API_'); setTimeout(()=>{process.stdout.write('KEY=hunter2\\n'); process.exit(0)}, 80)";
        await runExecWrapper({ logsRoot: dir, jobId: 'job-split', nonce: 'nonce-split', argv: ['node', '-e', script], cwd: '.' });
        const log = fs.readFileSync(logPath(dir, 'job-split', 'nonce-split'), 'utf8');
        expect(log).toContain('API_KEY=[REDACTED]');
        expect(log).not.toContain('hunter2');
    });

    test('el log se acota aprox. en MAX_LOG_BYTES cuando la salida supera el limite, no crece sin cota (R2.5)', async () => {  // verifies R2.5
        const MAX_LOG_BYTES = 1024 * 1024;
        const bytesToWrite = 2 * MAX_LOG_BYTES;  // 2MB, muy por encima del cap de 1MB
        const out = await runExecWrapper({
            logsRoot: dir, jobId: 'job6', nonce: 'nonceF',
            argv: ['node', '-e', `process.stdout.write('x'.repeat(${bytesToWrite}))`],
            cwd: '.',
        });
        expect(out.exitCode).toBe(0);
        const size = fs.statSync(logPath(dir, 'job6', 'nonceF')).size;
        // el append corta apenas se cruza el cap (chequeo ANTES de cada chunk),
        // asi que el tamano final ronda MAX_LOG_BYTES +/- un ultimo chunk de
        // pipe, jamas los 2MB reales escritos por el comando (R2.5).
        expect(size).toBeGreaterThanOrEqual(MAX_LOG_BYTES);
        expect(size).toBeLessThan(MAX_LOG_BYTES * 1.5);
        expect(size).toBeLessThan(bytesToWrite);
    }, 10000);

    test('no se cuelga si un descendiente hereda stdio y no lo cierra (R1.8)', async () => {  // verifies R1.8
        const script = "const {spawn}=require('child_process'); const gc=spawn('sleep',['3'],{stdio:'inherit',detached:true}); gc.unref(); process.exit(0);";
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job5', nonce: 'nonceE', argv: ['node', '-e', script], cwd: '.' });
        expect(out.exitCode).toBe(0);
    }, 10000);

    test('no publica pass hasta drenar descendientes que quedan en el process group del comando', async () => {
        const script = "require('child_process').spawn('sleep',['30'],{stdio:'ignore'}); process.exit(0);";
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job7', nonce: 'nonceG', argv: ['node', '-e', script], cwd: '.' });
        const identity = JSON.parse(fs.readFileSync(identityPath(dir, 'job7', 'nonceG'), 'utf8'));
        expect(out.exitCode).toBe(0);
        expect(groupIsGone(identity.command.processGroup)).toBe(true);
    }, 10000);
});
