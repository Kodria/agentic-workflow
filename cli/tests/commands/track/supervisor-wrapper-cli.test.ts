// Task 8 post-review item 3: CLI-level coverage de `awm track supervisor-wrapper`
// — el registro de flags requeridos y el guard de descriptor, invocados vía
// Commander (mismo patrón que verbs.test.ts), no llamando a
// `runSupervisorWrapper` directamente. El único escenario que llega a
// ejecutar el wrapper real deja el track BLOCKED en el journal del plan para
// que retorne sin nunca spawnear `awm watch` de verdad.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerTrackCommand } from '../../../src/commands/track';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { writeDescriptor } from '../../../src/core/tracks/descriptor';
import { trackRefFixture, descriptorFixture } from './fixtures';

class ExitSignal extends Error { constructor(public code: number) { super(`process.exit(${code})`); } }

function git(repo: string, args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function gitInit(repo: string, branch: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', branch], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

async function runCli(repo: string, argv: string[]): Promise<{ out: string; err: string; exitCode: number }> {
    const prog = new Command();
    prog.exitOverride();
    registerTrackCommand(prog);
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(repo);
    let exitCode = 0;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCode = code ?? 0;
        throw new ExitSignal(exitCode);
    }) as never);
    try {
        await prog.parseAsync(['node', 'awm', ...argv]);
    } catch (e) {
        if (e instanceof ExitSignal) {
            // ya capturado por el spy de process.exit
        } else if (typeof (e as { exitCode?: unknown }).exitCode === 'number') {
            exitCode = (e as { exitCode: number }).exitCode;
        } else {
            throw e;
        }
    } finally {
        cwdSpy.mockRestore();
        exitSpy.mockRestore();
    }
    const out = outSpy.mock.calls.map((c) => String(c[0])).join('');
    const err = errSpy.mock.calls.map((c) => String(c[0])).join('');
    outSpy.mockRestore();
    errSpy.mockRestore();
    return { out, err, exitCode };
}

describe('awm track supervisor-wrapper — CLI (R4.7, R9.4, post-review item 3)', () => {
    let planRoot: string;
    let trackRoot: string;

    beforeEach(() => {
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrapper-cli-plan-'));
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrapper-cli-track-'));
        gitInit(planRoot, 'main');
        gitInit(trackRoot, 'track/cli');
        initJournal(planRoot, 'main');
    });

    afterEach(() => {
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(trackRoot, { recursive: true, force: true });
    });

    test.each([
        ['sin --track', ['track', 'supervisor-wrapper', '--readiness', 'r', '--fence', 'f', '--nonce', 'n']],
        ['sin --readiness', ['track', 'supervisor-wrapper', '--track', 'cli', '--fence', 'f', '--nonce', 'n']],
        ['sin --fence', ['track', 'supervisor-wrapper', '--track', 'cli', '--readiness', 'r', '--nonce', 'n']],
        ['sin --nonce', ['track', 'supervisor-wrapper', '--track', 'cli', '--readiness', 'r', '--fence', 'f']],
    ])('%s: commander rechaza antes de tocar ningún descriptor/journal', async (_label, argv) => {
        const out = await runCli(trackRoot, argv);
        expect(out.exitCode).not.toBe(0);
    });

    test('sin descriptor de track en el cwd: rechaza sin autenticar (R9.4)', async () => {
        const out = await runCli(trackRoot, ['track', 'supervisor-wrapper', '--track', 'cli', '--readiness', 'r', '--fence', 'f', '--nonce', 'n']);
        expect(out.exitCode).toBe(1);
        expect(out.err).toContain('sin descriptor de track');
    });

    test('descriptor presente pero trackId no coincide con --track: aborta antes de reclamar nada', async () => {
        writeDescriptor(trackRoot, descriptorFixture({ trackId: 'cli' }, planRoot));
        const out = await runCli(trackRoot, ['track', 'supervisor-wrapper', '--track', 'otro-track', '--readiness', 'r', '--fence', 'f'.repeat(32), '--nonce', 'n']);
        expect(out.exitCode).toBe(1);
        expect(out.err).toContain('no coincide');
        expect(fs.existsSync(path.join(trackRoot, '.awm', 'supervisor.claim'))).toBe(false);
    });

    test('descriptor presente pero fencingToken no coincide con --fence: aborta antes de reclamar nada', async () => {
        writeDescriptor(trackRoot, descriptorFixture({ trackId: 'cli', fencingToken: 'f'.repeat(32) }, planRoot));
        const out = await runCli(trackRoot, ['track', 'supervisor-wrapper', '--track', 'cli', '--readiness', 'r', '--fence', 'g'.repeat(32), '--nonce', 'n']);
        expect(out.exitCode).toBe(1);
        expect(out.err).toContain('no coincide');
        expect(fs.existsSync(path.join(trackRoot, '.awm', 'supervisor.claim'))).toBe(false);
    });

    test('descriptor autenticado: reclama, escribe sidecars, y sale 0 sin lanzar `awm watch` cuando el plan bloquea el track', async () => {
        writeDescriptor(trackRoot, descriptorFixture({ trackId: 'cli', planBranch: 'main', fencingToken: 'f'.repeat(32) }, planRoot));
        const planState = readJournal(planRoot, 'main').state!;
        planState.tracks = [trackRefFixture({ trackId: 'cli', phase: 'BLOCKED', readinessNonce: 'nonce-cli'.padEnd(32, '0') }, trackRoot)];
        writeJournal(planRoot, 'main', planState);

        const out = await runCli(trackRoot, [
            'track', 'supervisor-wrapper', '--track', 'cli',
            '--readiness', 'nonce-cli'.padEnd(32, '0'), '--fence', 'f'.repeat(32), '--nonce', 'real-nonce',
        ]);
        expect(out.exitCode).toBe(0);
        expect(fs.existsSync(path.join(trackRoot, '.awm', 'supervisor.claim'))).toBe(true);
        const identity = JSON.parse(fs.readFileSync(path.join(trackRoot, '.awm', 'supervisor.identity.json'), 'utf8'));
        expect(identity.nonce).toBe('real-nonce');   // el eco end-to-end del nonce también se ejercita vía CLI
    });
});
