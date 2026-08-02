import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerTrackCommand } from '../../../src/commands/track';
import { initJournal } from '../../../src/core/journal/store';
import { statePath } from '../../../src/core/journal/paths';
import { listPendingRequests } from '../../../src/core/journal/requests';

// Superficie `awm track` (R5.10, R6.1, R9.5, R9.6): los verbos mutantes
// (add/join/remove) SOLO emiten una request inmutable — jamas tocan Git ni
// state.json (single-writer, R6.1); los verbos read-only (list/status/
// verify-independence) jamas aceptan --generation ni emiten nada.

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

function readPendingKinds(repo: string, branch: string): string[] {
    return listPendingRequests(repo, branch).filter((p) => !p.corrupt).map((p) => p.envelope.kind);
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
            // exitOverride(): errores/--help propios de commander (opcion
            // desconocida, --generation faltante, --help) nunca llaman a
            // process.exit — lanzan un CommanderError con exitCode propio.
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

describe('awm track — verbos mutantes son request-only (R6.1)', () => {
    let repo: string;
    const branch = 'main';

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-verbs-'));
        gitInit(repo, branch);
        initJournal(repo, branch);
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test.each([
        ['add', 'track-prepare-request'],
        ['join', 'track-join-request'],
        ['remove', 'track-teardown-request'],
    ])('%s emite %s y no muta Git/state (R6.1)', async (verb, kind) => {
        const beforeHead = git(repo, ['rev-parse', 'HEAD']);
        const beforeState = fs.readFileSync(statePath(repo, branch), 'utf8');
        const out = await runCli(repo, ['track', verb, 'cli', '--generation', 'g1']);
        expect(out.exitCode).toBe(0);
        expect(readPendingKinds(repo, branch)).toContain(kind);
        expect(git(repo, ['rev-parse', 'HEAD'])).toBe(beforeHead);
        expect(fs.readFileSync(statePath(repo, branch), 'utf8')).toBe(beforeState);
    });

    test.each(['add', 'join', 'remove'])('%s exige --generation (Commander valida antes de emitir)', async (verb) => {
        const out = await runCli(repo, ['track', verb, 'cli']);
        expect(out.exitCode).not.toBe(0);
        expect(readPendingKinds(repo, branch)).toEqual([]);
    });

    test.each(['add', 'join', 'remove'])('%s sin argumento <trackId> falla en commander, no emite nada', async (verb) => {
        const out = await runCli(repo, ['track', verb, '--generation', 'g1']);
        expect(out.exitCode).not.toBe(0);
        expect(readPendingKinds(repo, branch)).toEqual([]);
    });
});

describe('awm track list/status — read-only, sin --generation (R9.5)', () => {
    let repo: string;
    const branch = 'main';

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-list-'));
        gitInit(repo, branch);
        initJournal(repo, branch);
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('list no acepta --generation y no emite requests', async () => {
        const out = await runCli(repo, ['track', 'list', '--generation', 'g1']);
        expect(out.exitCode).not.toBe(0);   // commander: opcion desconocida
        expect(readPendingKinds(repo, branch)).toEqual([]);
    });

    test('list imprime los tracks del journal (vacio por defecto) sin mutar nada', async () => {
        const beforeState = fs.readFileSync(statePath(repo, branch), 'utf8');
        const out = await runCli(repo, ['track', 'list']);
        expect(out.exitCode).toBe(0);
        expect(JSON.parse(out.out)).toEqual({ tracks: [] });
        expect(fs.readFileSync(statePath(repo, branch), 'utf8')).toBe(beforeState);
    });

    test('status no acepta --generation', async () => {
        const out = await runCli(repo, ['track', 'status', '--generation', 'g1']);
        expect(out.exitCode).not.toBe(0);
        expect(readPendingKinds(repo, branch)).toEqual([]);
    });

    test('status con journal sin tracks agrega cohort "sin tracks declarados" y sale 0', async () => {
        const out = await runCli(repo, ['track', 'status']);
        expect(out.exitCode).toBe(0);
        expect(JSON.parse(out.out)).toEqual({ cohort: 'sin tracks declarados', tracks: {} });
    });
});

describe('awm track verify-independence — R5.10', () => {
    const fixture = (name: string) => path.join(__dirname, '../../fixtures/tracks', name);

    test('plan con tracks disjuntos: parallel:true, sale 0', async () => {
        const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', fixture('two-independent.md')]);
        expect(out.exitCode).toBe(0);
        expect(JSON.parse(out.out)).toEqual({ parallel: true, reasons: [] });
    });

    test('plan sin membresia de tracks degrada a serial: parallel:false, sale 1', async () => {
        const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', fixture('legacy-serial.md')]);
        expect(out.exitCode).toBe(1);
        expect(JSON.parse(out.out)).toEqual({ parallel: false, reasons: ['no-tracks'] });
    });

    test('tracks con ownership superpuesto: parallel:false, sale 1, nombra el path (R5.1)', async () => {
        const overlapping = fs.readFileSync(fixture('two-independent.md'), 'utf8')
            .replace('docs/a.md', 'cli/src/a.ts');
        const tmp = path.join(os.tmpdir(), `awm-overlap-${Date.now()}.md`);
        fs.writeFileSync(tmp, overlapping);
        try {
            const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', tmp]);
            expect(out.exitCode).toBe(1);
            const parsed = JSON.parse(out.out);
            expect(parsed.parallel).toBe(false);
            expect(parsed.reasons).toContain('path:cli/src/a.ts');
        } finally {
            fs.rmSync(tmp, { force: true });
        }
    });

    test('verify-independence no emite requests ni exige journal/branch', async () => {
        // deliberadamente NO se llama gitInit/initJournal en process.cwd(): el
        // verbo es puro sobre el archivo de plan, no toca .awm/journal.
        const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', fixture('two-independent.md')]);
        expect(out.exitCode).toBe(0);
    });
});

describe('awm track --help lista exactamente los 6 verbos', () => {
    test('help incluye add, list, status, verify-independence, join, remove', async () => {
        const out = await runCli(process.cwd(), ['track', '--help']);
        for (const verb of ['add', 'list', 'status', 'verify-independence', 'join', 'remove']) {
            expect(out.out).toContain(verb);
        }
    });
});
