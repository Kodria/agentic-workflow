import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerTrackCommand } from '../../../src/commands/track';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { statePath } from '../../../src/core/journal/paths';
import { listPendingRequests } from '../../../src/core/journal/requests';
import { writeDescriptor, type TrackDescriptor } from '../../../src/core/tracks/descriptor';
import type { TrackRef } from '../../../src/core/journal/types';

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

function trackRefFixture(overrides: Partial<TrackRef>, worktreePath: string): TrackRef {
    return {
        trackId: 'cli', worktreePath, branch: 'track/cli', ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: 'f'.repeat(32), phase: 'ACTIVE', readinessNonce: 'n'.repeat(8), ...overrides,
    };
}

function descriptorFixture(overrides: Partial<TrackDescriptor>, planRoot: string): TrackDescriptor {
    return { schema: 1, planRoot, planBranch: 'main', trackId: 'cli', planJournalId: 'j-1', fencingToken: 'f'.repeat(32), ...overrides };
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

    test('plan con violacion a nivel de PARSER (id de track peligroso) reporta {parallel:false} y sale 1 — jamas un stack trace crudo', async () => {
        // parseTrackPlan lanza sincronicamente ante un id de track peligroso
        // (ver tests/core/tracks/plan-parser.test.ts) — antes del fix, este
        // throw escapaba sin capturar y tumbaba el proceso entero.
        const broken = fs.readFileSync(fixture('two-independent.md'), 'utf8').replaceAll('cli', '..');
        const tmp = path.join(os.tmpdir(), `awm-badid-${Date.now()}.md`);
        fs.writeFileSync(tmp, broken);
        try {
            const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', tmp]);
            expect(out.exitCode).toBe(1);
            const parsed = JSON.parse(out.out);
            expect(parsed.parallel).toBe(false);
            expect(parsed.reasons).toHaveLength(1);
            expect(parsed.reasons[0]).toMatch(/^parse-error:.*track id inválido/);
        } finally {
            fs.rmSync(tmp, { force: true });
        }
    });

    test('archivo de plan inexistente tambien reporta {parallel:false} estructurado, no un ENOENT crudo', async () => {
        const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', '/no/existe/plan.md']);
        expect(out.exitCode).toBe(1);
        const parsed = JSON.parse(out.out);
        expect(parsed).toEqual({ parallel: false, reasons: [expect.stringMatching(/^parse-error:/)] });
    });

    test('shared resource sin forma <clase>:<valor> (canonicalResource, ownership.ts) tambien reporta JSON estructurado, no un stack trace (bug hermano post-fix)', async () => {
        // El parser NUNCA valida la forma de "Shared resources" — solo revisa
        // que la celda no este vacia (plan-parser.ts). `canonicalResource`
        // lanza recien DENTRO de assessDeclaredIndependence, un paso despues
        // del parseo: el primer fix de este verbo envolvia solo
        // read+parseTrackPlan y dejaba escapar exactamente este throw.
        const malformed = fs.readFileSync(fixture('two-independent.md'), 'utf8')
            .replace('| cli | none | [] |', '| cli | none | badresource |');
        const tmp = path.join(os.tmpdir(), `awm-badresource-${Date.now()}.md`);
        fs.writeFileSync(tmp, malformed);
        try {
            const out = await runCli(process.cwd(), ['track', 'verify-independence', '--plan', tmp]);
            expect(out.exitCode).toBe(1);
            const parsed = JSON.parse(out.out);
            expect(parsed.parallel).toBe(false);
            expect(parsed.reasons).toHaveLength(1);
            expect(parsed.reasons[0]).toMatch(/^parse-error:.*recurso debe usar/);
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

describe('awm track list/status — guard de contexto de PLAN (distinto de R9.4)', () => {
    let planRoot: string;
    let trackRoot: string;

    beforeEach(() => {
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-plan-'));
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-worktree-'));
        gitInit(planRoot, 'main');
        gitInit(trackRoot, 'track/cli');

        initJournal(planRoot, 'main');
        const planState = readJournal(planRoot, 'main').state!;
        planState.journalId = 'j-1';
        planState.tracks = [trackRefFixture({}, trackRoot)];
        writeJournal(planRoot, 'main', planState);

        initJournal(trackRoot, 'track/cli');
        const trackState = readJournal(trackRoot, 'track/cli').state!;
        trackState.trackContext = { trackId: 'cli', taskIds: [], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        writeJournal(trackRoot, 'track/cli', trackState);
        writeDescriptor(trackRoot, descriptorFixture({ planJournalId: 'j-1' }, planRoot));
    });

    afterEach(() => {
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(trackRoot, { recursive: true, force: true });
    });

    test.each(['list', 'status'])('`track %s` desde la RAIZ DEL PLAN funciona con normalidad', async (verb) => {
        const out = await runCli(planRoot, ['track', verb]);
        expect(out.err).toBe('');
        // "sin tracks declarados"/{tracks:[...]} — lo que sea, pero SIN
        // reject por contexto (ese es el punto de este guard especifico).
        expect(out.exitCode).not.toBeNull();
    });

    test.each(['list', 'status'])(
        '`track %s` desde el WORKTREE DE UN TRACK rechaza con mensaje claro, no "sin tracks declarados" silencioso',
        async (verb) => {
            const out = await runCli(trackRoot, ['track', verb]);
            expect(out.exitCode).toBe(1);
            expect(out.out).toBe('');   // nunca imprime un agregado vacio enganoso
            expect(out.err).toContain('worktree del track');
            expect(out.err).toContain('cli');
            expect(out.err).not.toContain('cwd no autenticado');   // no es un fallo de R9.4, es de contexto
        },
    );

    test('`track status` sigue rechazando un cwd que NO autentica en absoluto (R9.4 sigue vigente)', async () => {
        const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-other-'));
        try {
            gitInit(otherRoot, 'track/cli');
            initJournal(otherRoot, 'track/cli');
            const otherState = readJournal(otherRoot, 'track/cli').state!;
            otherState.trackContext = { trackId: 'cli', taskIds: [], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
            writeJournal(otherRoot, 'track/cli', otherState);
            // mismo descriptor "logico" que trackRoot, pero su realpath JAMAS
            // coincide con el TrackRef del plan — resolveCommandContext debe
            // rechazar ANTES de que el guard de plan-vs-track entre en juego.
            writeDescriptor(otherRoot, descriptorFixture({ planJournalId: 'j-1' }, planRoot));
            const out = await runCli(otherRoot, ['track', 'status']);
            expect(out.exitCode).toBe(1);
            expect(out.err).toContain('cwd no autenticado');
        } finally {
            fs.rmSync(otherRoot, { recursive: true, force: true });
        }
    });
});

describe('awm track status — sale 1 con gate rojo a nivel CLI (Gap: solo se probaba la funcion pura)', () => {
    let planRoot: string;
    let trackRoot: string;

    beforeEach(() => {
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-status-plan-'));
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-status-track-'));
        gitInit(planRoot, 'main');
        gitInit(trackRoot, 'track/cli');
        initJournal(planRoot, 'main');
        initJournal(trackRoot, 'track/cli');
    });

    afterEach(() => {
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(trackRoot, { recursive: true, force: true });
    });

    test('un track con tarea pending hace que `track status` (CLI) salga 1, no solo la funcion pura', async () => {
        // trackContext presente + una tarea 'pending' basta para que
        // computeTrackGate falle (categoria pending-task) — sin necesidad de
        // reconstruir un journal que pase entero, al reves del test de
        // status.test.ts que si cubre el camino verde.
        const trackState = readJournal(trackRoot, 'track/cli').state!;
        trackState.trackContext = { trackId: 'cli', taskIds: ['T1'], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        trackState.tasks.push({ id: 'T1', title: 't', status: 'pending', attempts: 0, verificationPlan: [], reviewObligations: [] });
        writeJournal(trackRoot, 'track/cli', trackState);

        const planState = readJournal(planRoot, 'main').state!;
        planState.tracks = [trackRefFixture({}, trackRoot)];
        writeJournal(planRoot, 'main', planState);

        const out = await runCli(planRoot, ['track', 'status']);
        expect(out.exitCode).toBe(1);
        const parsed = JSON.parse(out.out);
        expect(parsed.tracks.cli.gate.pass).toBe(false);
        expect(parsed.tracks.cli.gate.reasons.some((r: { category: string }) => r.category === 'pending-task')).toBe(true);
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
