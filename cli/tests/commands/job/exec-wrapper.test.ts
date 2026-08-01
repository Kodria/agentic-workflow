import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExecWrapper, claimPath, identityPath, resultPath, replayVerdict, logPath } from '../../../src/commands/job/exec-wrapper';

describe('exec-wrapper', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrap-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    test('claim + identity sidecar + resultado terminal atomico (R1.8)', async () => {  // verifies R1.8
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job1', nonce: 'nonceA', argv: ['node', '-e', 'setTimeout(()=>process.exit(0), 300)'], cwd: process.cwd() });
        expect(out.exitCode).toBe(0);
        expect(fs.existsSync(claimPath(dir, 'job1', 'nonceA'))).toBe(true);
        const identity = JSON.parse(fs.readFileSync(identityPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(identity.wrapper.pid).toBe(process.pid);            // ProcessRef REAL del wrapper
        expect(identity.command.pid).toBeGreaterThan(0);           // ProcessRef REAL del comando
        expect(identity.command.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        expect(identity.command.processGroup).toBe(identity.wrapper.processGroup);  // un grupo por job
        const result = JSON.parse(fs.readFileSync(resultPath(dir, 'job1', 'nonceA'), 'utf8'));
        expect(result.exitCode).toBe(0);
    });

    test('segundo claim con el mismo nonce falla: exactly-once (R1.8)', async () => {  // verifies R1.8
        await runExecWrapper({ logsRoot: dir, jobId: 'job2', nonce: 'nonceB', argv: ['node', '-e', 'process.exit(0)'], cwd: process.cwd() });
        await expect(runExecWrapper({ logsRoot: dir, jobId: 'job2', nonce: 'nonceB', argv: ['node', '-e', 'process.exit(0)'], cwd: process.cwd() }))
            .rejects.toThrow(/claim/);
    });

    test('comando inexistente produce resultado 127, no crash (R1.8)', async () => {  // verifies R1.8
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job3', nonce: 'nonceC', argv: ['binario-inexistente-xyz'], cwd: process.cwd() });
        expect(out.exitCode).toBe(127);
        expect(replayVerdict(dir, 'job3', 'nonceC')).toBe('completed');
    });

    test('matriz de replay: sin claim / claim+resultado / claim sin resultado (R1.8)', async () => {  // verifies R1.8
        expect(replayVerdict(dir, 'jobX', 'n1')).toBe('never-started');       // sin claim => re-spawn seguro
        await runExecWrapper({ logsRoot: dir, jobId: 'jobY', nonce: 'n2', argv: ['node', '-e', 'process.exit(3)'], cwd: process.cwd() });
        expect(replayVerdict(dir, 'jobY', 'n2')).toBe('completed');           // adoptar resultado
        fs.writeFileSync(claimPath(dir, 'jobZ', 'n3'), '{"claimed":true}');   // claim sin resultado
        expect(replayVerdict(dir, 'jobZ', 'n3')).toBe('unprovable');          // orphaned, jamas relanzar solo
    });

    test('el log captura la salida completa incluso si exit llega antes que el flush de stdio (R2.5)', async () => {  // verifies R2.5
        await runExecWrapper({ logsRoot: dir, jobId: 'job4', nonce: 'nonceD', argv: ['node', '-e', "process.stdout.write('linea-final-no-se-debe-perder'); process.exit(0)"], cwd: process.cwd() });
        const log = fs.readFileSync(logPath(dir, 'job4', 'nonceD'), 'utf8');
        expect(log).toContain('linea-final-no-se-debe-perder');
    });

    test('no se cuelga si un descendiente hereda stdio y no lo cierra (R1.8)', async () => {  // verifies R1.8
        const script = "const {spawn}=require('child_process'); const gc=spawn('sleep',['3'],{stdio:'inherit',detached:true}); gc.unref(); process.exit(0);";
        const out = await runExecWrapper({ logsRoot: dir, jobId: 'job5', nonce: 'nonceE', argv: ['node', '-e', script], cwd: process.cwd() });
        expect(out.exitCode).toBe(0);
    }, 10000);
});
