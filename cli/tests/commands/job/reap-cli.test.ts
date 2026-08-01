import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerJobCommand } from '../../../src/commands/job';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { Job } from '../../../src/core/journal/types';

// CLI-level wiring de `job reap` (Gap 2 del post-implementation-qa): las
// funciones puras planReap/executeReap ya estan cubiertas en
// gate-reconcile.test.ts — esto prueba el comando REGISTRADO: (a) --execute
// sin --jobs falla con un mensaje claro, no un stack trace crudo; (b) el plan
// SIEMPRE se imprime antes de cualquier ejecucion (R2.2).

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', 'rama'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

function job(partial: Partial<Job>): Job {
    return {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'running', observationState: 'progressing',
        phaseTimestamps: {}, ...partial,
    };
}

async function run(argv: string[], cwd: string): Promise<{ out: string; error: Error | null }> {
    const prog = new Command();
    prog.exitOverride();
    registerJobCommand(prog);
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    let error: Error | null = null;
    try {
        await prog.parseAsync(['node', 'awm', 'job', ...argv]);
    } catch (e) {
        error = e as Error;
    } finally {
        cwdSpy.mockRestore();
    }
    const out = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
    return { out, error };
}

describe('awm job reap CLI wiring (R2.2)', () => {
    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reap-cli-'));
        gitInit(repo);
        initJournal(repo, 'rama');
        const s = readJournal(repo, 'rama').state!;
        // job sin processRef: excluido del plan (planReap solo reporta jobs con processRef)
        s.jobs['sinRef'] = job({ id: 'sinRef' });
        // job con processRef de un pid que ya no existe: aliveWithIdentity: false
        s.jobs['muerto'] = job({
            id: 'muerto',
            processRef: { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' },
        });
        writeJournal(repo, 'rama', s);
    });

    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('`job reap` sin --execute imprime el plan a stdout y no ejecuta nada', async () => {
        const { out, error } = await run(['reap'], repo);
        expect(error).toBeNull();
        const plan = JSON.parse(out);
        expect(Array.isArray(plan)).toBe(true);
        // solo el job con processRef aparece
        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({ jobId: 'muerto', pid: 999999, aliveWithIdentity: false });
        // no se imprimio un segundo bloque {killed: ...} — no hubo ejecucion
        expect(out).not.toContain('killed');
    });

    test('`job reap --execute` sin --jobs falla con un error claro, no un stack trace crudo', async () => {
        const { out, error } = await run(['reap', '--execute'], repo);
        expect(error).not.toBeNull();
        expect(error!.message).toMatch(/--execute requiere --jobs/);
        // R2.2: el plan se imprimio ANTES de que la falta de --jobs abortara la ejecucion
        const plan = JSON.parse(out);
        expect(Array.isArray(plan)).toBe(true);
        expect(plan).toHaveLength(1);
    });

    test('`job reap --execute --jobs <id>` imprime el plan primero y luego el resultado de la ejecucion', async () => {
        const { out, error } = await run(['reap', '--execute', '--jobs', 'muerto'], repo);
        expect(error).toBeNull();
        // dos bloques JSON concatenados: el plan, despues {killed:[...]}
        const planEndIdx = out.indexOf('\n]\n') + 3;
        const planPart = out.slice(0, planEndIdx);
        const resultPart = out.slice(planEndIdx);
        const plan = JSON.parse(planPart);
        expect(plan).toHaveLength(1);
        const result = JSON.parse(resultPart);
        // identidad muerta => nunca se envio senial, killed vacio (R2.1)
        expect(result).toEqual({ killed: [] });
    });
});
