// R5 Task 15 — E2E de aceptación de los tracks paralelos (CA-4.1–CA-4.3).
//
// **Los snippets del plan estaban escritos contra una API imaginada.** Task 15 esperaba
// `runWorkload()` devolviendo `{ cycleStatus, treeHash, events: [{ kind: 'parallel-degraded' }] }`
// y un seam llamado `worktreeAdder`. Nada de eso existe: la implementación shippeó
// `reconcileTracks` devolviendo `{ state, effectExecuted }`, la degradación como
// `fallbackReason` en el journal, y el seam como `TrackRuntime.addWorktree`.
//
// Es la CUARTA vez en este repo que una especificación se escribe contra lo que se
// esperaba y no contra lo que hay (las otras: `--type` en `add`, `AG-03`, `CORE-17`). Se
// resuelve igual que las anteriores: los tests se escriben contra el contrato REAL, y la
// discrepancia se deja anotada — forzar la implementación a parecerse a un plan escrito
// antes que ella sería cambiar código que funciona para satisfacer una suposición.
//
// Lo que NO cambia es qué se verifica: CA-4.1, CA-4.2 y CA-4.3 siguen siendo los criterios.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { parseTrackPlan } from '../../src/core/tracks/plan-parser';
import type { ParsedTrack } from '../../src/core/tracks/plan-parser';
import { assessDeclaredIndependence, assessActualOwnership } from '../../src/core/tracks/ownership';
import { reconcileTracks, defaultTrackRuntime } from '../../src/commands/watch/tracks';
import type { TrackRuntime, SupervisorObservation } from '../../src/commands/watch/tracks';
import { initJournal, readJournal, writeJournal } from '../../src/core/journal/store';
import { captureSelfRef } from '../../src/core/journal/process';
import type { JournalState, TrackRef } from '../../src/core/journal/types';

const WORKLOAD = path.join(__dirname, '..', 'fixtures', 'tracks', 'workload');

function readPlan(): string {
    return fs.readFileSync(path.join(WORKLOAD, 'plan.md'), 'utf8');
}

/** El fixture DEBE parsear como candidato a paralelo — si degradara a `serial`, todos los
 *  criterios de abajo estarían midiendo otra cosa. Narrow explícito para que un cambio en
 *  el fixture falle acá, con nombre, y no en un `undefined` diez líneas después. */
function parsePlan(): { tracks: ParsedTrack[]; argv: string[]; paths: string[] } {
    const parsed = parseTrackPlan(readPlan(), () => true);
    if (parsed.mode !== 'parallel-candidate') {
        throw new Error(`el fixture del workload degradó a serial: ${parsed.reason}`);
    }
    return { tracks: Object.values(parsed.tracks), argv: parsed.integration.argv, paths: parsed.integration.paths };
}

/** Devuelve los tracks con el ownership de `trackId` reemplazado — para probar el efecto de
 *  UNA declaración sobre el veredicto de TODA la cohorte sin tocar el fixture en disco. */
function withOwnership(trackId: string, ownership: string[]): ParsedTrack[] {
    return parsePlan().tracks.map((t) => (t.trackId === trackId ? { ...t, ownership } : t));
}

/** Todo tmpdir creado por esta suite, para que el `afterEach` remueva SOLO lo propio incluso
 *  cuando un `expect` falla antes del cleanup inline (Step 7: la corrida N+1 no puede
 *  heredar basura de la N). El borrado es idempotente: `force: true` sobre algo ya removido
 *  es un no-op. */
const created: string[] = [];

afterEach(() => {
    while (created.length > 0) {
        const dir = created.pop()!;
        // `git worktree` deja el repo principal con referencias a worktrees ya borrados; el
        // prune evita que un `git worktree list` posterior las reporte como vivas.
        try { execFileSync('git', ['worktree', 'prune'], { cwd: dir, stdio: 'pipe' }); } catch { /* no es un repo, o ya no existe */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/** Registra un tmpdir propio para el `afterEach` y lo devuelve. */
function track(dir: string): string {
    created.push(dir);
    return dir;
}

/** Repo con el estado inicial del workload y git utilizable sin config global.
 *  El `.gitignore` con `.awm/` no es decorativo: `defaultTrackRuntime.addWorktree` descarta
 *  el worktree recién creado si no puede PROBAR que `.awm` está ignorado (degradación C2), y
 *  además es lo que hace que el árbol del camino serial y el del paralelo sean comparables —
 *  el journal del track nunca entra al árbol versionado. */
function seedRepo(): string {
    const repo = track(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-r5-e2e-'))));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'e2e@awm.test');
    git('config', 'user.name', 'AWM E2E');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.awm/\n');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'A-inicial\n');
    fs.writeFileSync(path.join(repo, 'src', 'b.txt'), 'B-inicial\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'seed');
    return repo;
}

/** Corre el trabajo de un track con el mismo `apply-task.mjs` que usaría el track real:
 *  argv estructurado, sin shell. */
function applyTask(repo: string, file: string, value: string): void {
    execFileSync(process.execPath, [path.join(WORKLOAD, 'apply-task.mjs'), path.join(repo, file), value], { stdio: 'pipe' });
}

/** El comando canónico de integración del plan, ejecutado como el supervisor lo haría:
 *  argv del plan, cwd = repo, sin shell. Devuelve el exit code. */
function runIntegration(repo: string): number {
    const { argv } = parsePlan();
    const [command, ...args] = argv;
    // El argv del plan referencia el verificador por ruta relativa al repo del CLI; en el
    // repo temporal se resuelve contra el fixture real.
    const resolved = args.map((a) => (a.endsWith('verify.mjs') ? path.join(WORKLOAD, 'verify.mjs') : a));
    // `node` del plan se resuelve al ejecutable de esta corrida: en Windows CI el `node` del
    // PATH puede no existir bajo el mismo nombre, y un ENOENT ahí sería un falso rojo del
    // criterio, no una integración fallida.
    const bin = command === 'node' ? process.execPath : command;
    try {
        execFileSync(bin, resolved, { cwd: repo, stdio: 'pipe' });
        return 0;
    } catch (e) {
        return (e as { status?: number }).status ?? 1;
    }
}

function treeHashOf(repo: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
}

function headOf(repo: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

describe('R5 · el plan del workload declara dos tracks realmente independientes', () => {
    it('parsea el argv de integración como ARRAY, no como prosa (C4)', () => {
        const parsed = parsePlan();
        // Que sea un array es la propiedad, no un detalle: prosa libre no puede
        // seleccionar el comando que se ejecuta sobre el HEAD final.
        expect(Array.isArray(parsed.argv)).toBe(true);
        expect(parsed.argv[0]).toBe('node');
        expect(parsed.paths).toEqual(['src/**']);
        expect(parsed.tracks.map((t) => t.trackId).sort()).toEqual(['a', 'b']);
    });

    it('los dos tracks pasan la evaluación de independencia declarada', () => {
        const { tracks } = parsePlan();
        expect(assessDeclaredIndependence(tracks)).toEqual({ parallel: true, reasons: [] });
    });
});

// ---------------------------------------------------------------------------
// CA-4.1 — serial y paralelo producen el MISMO ÁRBOL
// ---------------------------------------------------------------------------
//
// Sobre tree hash y NO sobre historial, a proposito: integrar A→B y B→A produce commits
// distintos y el mismo contenido. Comparar el historial daria un rojo que no significa
// nada, y es el error que este criterio existe para no cometer.

/** Integra los dos tracks en el orden pedido y devuelve árbol, commit y exit del comando
 *  canónico. Cada track trabaja en su propia rama, como en la ejecución real. */
function integrate(order: ('a' | 'b')[]): { tree: string; commit: string; verify: number } {
    const repo = seedRepo();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    for (const track of order) {
        git('checkout', '-q', '-b', `awm-track/${track}`, 'main');
        applyTask(repo, `src/${track}.txt`, `${track.toUpperCase()}-final`);
        git('add', '-A');
        git('commit', '-q', '-m', `track ${track}`);
        git('checkout', '-q', 'main');
    }
    for (const track of order) git('merge', '-q', '--no-ff', '-m', `join ${track}`, `awm-track/${track}`);
    return { tree: treeHashOf(repo), commit: headOf(repo), verify: runIntegration(repo) };
}

/** El árbol que produce el camino PARALELO — la referencia contra la que CA-4.2 compara su
 *  camino degradado. Se recalcula en vez de compartir estado entre tests: un `let` global
 *  haría que el orden de ejecución de los describes decidiera si CA-4.2 tiene contra qué
 *  comparar. */
const parallelTreeHash = (): string => integrate(['a', 'b']).tree;

describe('CA-4.1 · el orden de integración no cambia el resultado', () => {
    it('dos órdenes de integración distintos dan el mismo árbol y ambos verifican', () => {
        const ab = integrate(['a', 'b']);
        const ba = integrate(['b', 'a']);

        expect(ab.tree).toBe(ba.tree);
        // Los commits SÍ difieren — si coincidieran, el test no estaría probando nada
        // sobre el orden, estaría comparando la misma corrida consigo misma.
        expect(ab.commit).not.toBe(ba.commit);
        // Y el comando canónico acepta los dos: el trabajo de ambos tracks sobrevivió.
        expect(ab.verify).toBe(0);
        expect(ba.verify).toBe(0);
    });

    it('el verificador canónico REPRUEBA si se pierde el trabajo de un track', () => {
        // Sin esto, el test de arriba pasaría igual con un verificador que siempre
        // devuelve 0 — y no probaría que la integración vio los dos tracks.
        const repo = seedRepo();
        applyTask(repo, 'src/a.txt', 'A-final');
        expect(runIntegration(repo)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// CA-4.2 — un worktree que falla degrada a serial, y el serial DA LO MISMO
// ---------------------------------------------------------------------------
//
// El snippet del plan inyectaba un `worktreeAdder`; el seam real es
// `TrackRuntime.addWorktree`, y la degradación se observa como `cohortPhase: 'SERIAL'` +
// `fallbackReason`, no como un evento `parallel-degraded`.
//
// `track-bootstrap-crash.test.ts` ya prueba que el fallback desmantela los recursos reales
// y no deja worktrees vivos. Lo que NO estaba probado en ningún lado — y es la mitad de
// CA-4.2 que importa — es que el camino degradado no solo **termina**, sino que **termina
// con el mismo árbol** que el paralelo. Un fallback que completa produciendo otra cosa es
// peor que uno que bloquea: pasa desapercibido.

describe('CA-4.2 · un addWorktree que falla degrada a serial sin cambiar el resultado', () => {
    const BRANCH = 'main';

    /** Cohorte de dos tracks en `DECLARED`, escrita directo al journal — mismo patrón que
     *  `track-bootstrap-crash.test.ts`: `awm track` real no participa acá, lo que se
     *  ejercita es el reducer + los efectos reales de git. */
    function declareCohort(planRoot: string, worktreeRoot: string, baseSha: string): JournalState {
        initJournal(planRoot, BRANCH);
        const s = readJournal(planRoot, BRANCH).state!;
        s.cohortPhase = 'PREPARING';
        s.cohortBaseSha = baseSha;
        s.tracks = ['a', 'b'].map((id) => ({
            trackId: id,
            worktreePath: path.join(worktreeRoot, `track-${id}`),
            branch: `awm-track/${id}`,
            ownership: [`src/${id}.txt`], sharedResources: [], dependsOn: [],
            fencingToken: `fence-${id}`.padEnd(32, '0'),
            phase: 'DECLARED',
            readinessNonce: `ready-${id}`.padEnd(32, '0'),
        } satisfies TrackRef));
        writeJournal(planRoot, BRANCH, s);
        return readJournal(planRoot, BRANCH).state!;
    }

    /** git REAL para worktree/branch (única forma honesta de probar que no queda nada
     *  vivo); supervisor fake — acá no se ejercita el spawn de procesos, eso ya vive en
     *  `supervisor-wrapper.test.ts`. `addWorktree` falla para `failFor`. */
    function buildRuntime(planRoot: string, failFor: string): TrackRuntime {
        const real = defaultTrackRuntime(planRoot, BRANCH);
        const nunca = (name: string) => () => { throw new Error(`${name} no debería llamarse en el camino de fallback`); };
        return {
            addWorktree(root, ref, baseSha) {
                if (ref.trackId === failFor) throw new Error(`fallo inyectado: create-worktree de ${ref.trackId}`);
                real.addWorktree(root, ref, baseSha);
            },
            initTrackJournal(ref, context) { real.initTrackJournal(ref, context); },
            spawnSupervisor(ref) { return captureSelfRef(ref.readinessNonce); },
            observeSupervisor(ref): SupervisorObservation { return { kind: 'ready', readinessNonce: ref.readinessNonce }; },
            async stopOwnSupervisor() { return true; },
            removeOwnedWorktree(repo, ref) { real.removeOwnedWorktree(repo, ref); },
            removeOwnedBranch(repo, branch) { real.removeOwnedBranch(repo, branch); },
            emitFreezeRequest: nunca('emitFreezeRequest'),
            mergeFrozenTrack: nunca('mergeFrozenTrack'),
            abortOwnedMerge: nunca('abortOwnedMerge'),
            ensureIntegrationLock: nunca('ensureIntegrationLock'),
            pauseControllerGeneration: nunca('pauseControllerGeneration'),
            releaseIntegrationLockIfHeld: nunca('releaseIntegrationLockIfHeld'),
        };
    }

    /** El árbol que produce el camino serial: las dos tasks aplicadas una tras otra sobre
     *  `main`, sin worktrees, sin merges. */
    function serialTree(repo: string): { tree: string; verify: number } {
        const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
        for (const track of ['a', 'b'] as const) {
            applyTask(repo, `src/${track}.txt`, `${track.toUpperCase()}-final`);
            git('add', '-A');
            git('commit', '-q', '-m', `serial ${track}`);
        }
        return { tree: treeHashOf(repo), verify: runIntegration(repo) };
    }

    it('degrada a SERIAL nombrando la causa, no deja worktrees, y produce el mismo árbol', async () => {
        const planRoot = seedRepo();
        const worktreeRoot = track(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-r5-wt-'))));
        const baseSha = headOf(planRoot);
        const runtime = buildRuntime(planRoot, 'b');

        let s = declareCohort(planRoot, worktreeRoot, baseSha);
        for (let i = 0; i < 200 && s.cohortPhase !== 'SERIAL'; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }

        expect(s.cohortPhase).toBe('SERIAL');
        // La causa queda NOMBRADA y sobrevive a la reconstrucción del protocolo en cada
        // vuelta del loop — un fallback anónimo no es auditable.
        expect(s.cohortFallbackReason).toBe('effect-failed:create-worktree:b');
        // Y se lee en el evento de la degradación misma, no correlacionando hacia atrás.
        const events = fs.readFileSync(path.join(planRoot, '.awm', 'journal', BRANCH, 'events.jsonl'), 'utf8')
            .split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(events).toContainEqual(expect.objectContaining({ effect: 'enter-serial', reason: 'effect-failed:create-worktree:b' }));
        // El evento que la originó sigue nombrando el fallo inyectado (CA-4.2 del plan).
        expect(events).toContainEqual(expect.objectContaining({
            kind: 'track-effect-failed', trackId: 'b', detail: expect.stringContaining('inyectado'),
        }));
        // Prueba real contra git, no contra eventos: el track 'a' — que sí llegó a crear su
        // worktree antes de que 'b' fallara — quedó desmantelado.
        const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: planRoot, encoding: 'utf8' });
        expect(worktrees).not.toContain('awm-track/a');
        expect(fs.existsSync(path.join(worktreeRoot, 'track-a'))).toBe(false);
        expect(execFileSync('git', ['branch', '--list'], { cwd: planRoot, encoding: 'utf8' })).not.toContain('awm-track/');

        // Y ahora la mitad que nadie más cubre: el serial produce EL MISMO árbol que el
        // paralelo de CA-4.1, y el comando canónico lo acepta igual.
        const serial = serialTree(planRoot);
        expect(serial.verify).toBe(0);
        expect(serial.tree).toBe(parallelTreeHash());

    });
});

// ---------------------------------------------------------------------------
// CA-4.3 — una clase global invalida el paralelismo de TODA la cohorte (C5)
// ---------------------------------------------------------------------------

describe('CA-4.3 · tocar una clase global invalida la cohorte entera', () => {
    it('un solo track que declara package-lock.json apaga el paralelismo', () => {
        const trackA = parsePlan().tracks.find((t) => t.trackId === 'a')!;
        const conLockfile = withOwnership('a', [...trackA.ownership, 'package-lock.json']);

        const verdict = assessDeclaredIndependence(conLockfile);
        expect(verdict.parallel).toBe(false);
        expect(verdict.reasons).toContain('global:lockfile:package-lock.json');
    });

    it.each([
        ['package-lock.json', 'global:lockfile:package-lock.json'],
        ['pnpm-lock.yaml', 'global:lockfile:pnpm-lock.yaml'],
        ['package.json', 'global:manifest:package.json'],
        ['migrations/001.sql', 'global:migration:migrations/001.sql'],
    ])('%s se clasifica como global y nombra su clase', (file, reason) => {
        // Fail-closed por CLASE, no por archivo: la regla es que el paralelismo se apaga
        // ante lockfiles/manifests/migraciones, y el mensaje dice CUÁL para que la
        // decisión sea auditable en vez de un "no se puede" pelado.
        expect(assessDeclaredIndependence(withOwnership('a', [file])).reasons).toContain(reason);
    });

    it('la evaluación es de la COHORTE: basta que UN track lo toque', () => {
        // C5 en una línea. Si esto se relajara a "solo el track que lo toca va serial",
        // dos tracks podrían reescribir el mismo lockfile en paralelo.
        expect(assessDeclaredIndependence(withOwnership('b', ['yarn.lock'])).parallel).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Ownership REAL violado después de ejecutar (Task 15 Step 5)
// ---------------------------------------------------------------------------

describe('ownership real · lo declarado se contrasta contra lo que el track tocó', () => {
    it('un track que toca fuera de su ownership queda nombrado, archivo por archivo', () => {
        const trackA = parsePlan().tracks.find((t) => t.trackId === 'a')!;

        const assessment = assessActualOwnership(trackA, [
            { status: 'M', path: 'src/a.txt' },
            { status: 'M', path: 'outside.txt' },
        ]);

        expect(assessment.outsideOwnership).toEqual(['outside.txt']);
        // No es una violación de clase global: es trabajo fuera de lo declarado, y se
        // reporta distinto porque el remedio es distinto.
        expect(assessment.globalClasses).toEqual([]);
    });

    it('un rename cuenta las DOS puntas — el origen también es trabajo hecho', () => {
        const trackA = parsePlan().tracks.find((t) => t.trackId === 'a')!;

        const assessment = assessActualOwnership(trackA, [
            { status: 'R100', path: 'src/a.txt', oldPath: 'legacy/a.txt' },
        ]);

        // Mirar solo el destino diría que el track se portó bien, cuando en realidad
        // borró un archivo que no le pertenecía.
        expect(assessment.outsideOwnership).toEqual(['legacy/a.txt']);
    });
});
