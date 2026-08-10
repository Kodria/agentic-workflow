// Task 8 post-review items 1 (CRITICAL) + 4: cobertura con git REAL de
// `defaultTrackRuntime` — la única implementación que toca git/worktrees/
// gitignore de verdad. Todos los demás tests de `reconcileTracks` usan un
// `TrackRuntime` fake; este archivo es el que habría atrapado el bug crítico
// original (chequear `.gitignore` contra el HEAD vivo del plan en vez de
// contra el worktree recién creado, checkeado en `baseSha`).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { defaultTrackRuntime } from '../../../src/commands/watch/tracks';
import { isAwmGitignored, ownedWorktreeExists } from '../../../src/core/tracks/git';
import type { TrackRef, TrackContext } from '../../../src/core/journal/types';

function trackRef(worktreePath: string, overrides: Partial<TrackRef> = {}): TrackRef {
    return {
        trackId: 'x', worktreePath, branch: 'awm-track/x',
        ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: 'f'.repeat(32), phase: 'PREPARE_INTENT', readinessNonce: 'r'.repeat(32),
        ...overrides,
    };
}

describe('defaultTrackRuntime — integración con git real (R4.1, R4.6, C2, post-review CRITICAL fix)', () => {
    let planRoot: string;
    let worktreePath: string;

    beforeEach(() => {
        planRoot = initRepo();
        // `git worktree add` exige un destino que no exista o esté vacío: se
        // reserva el nombre con mkdtemp y se libera antes de usarlo, para que
        // el path sea único pero no un directorio ya ocupado por mkdtemp.
        worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-runtime-wt-'));
        fs.rmdirSync(worktreePath);
    });

    afterEach(() => {
        try { execFileSync('git', ['worktree', 'prune'], { cwd: planRoot, stdio: 'pipe' }); } catch { /* planRoot puede ya no ser un repo válido */ }
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(worktreePath, { recursive: true, force: true });
    });

    test('happy path: crea el worktree real cuando `.awm` ya está ignorado en baseSha', () => {
        commitFile(planRoot, '.gitignore', '.awm/\n');
        const baseSha = commitFile(planRoot, 'a.txt', 'contenido');   // baseSha SÍ incluye el .gitignore commiteado arriba
        const runtime = defaultTrackRuntime(planRoot, 'main');
        const ref = trackRef(worktreePath);

        expect(() => runtime.addWorktree(planRoot, ref, baseSha)).not.toThrow();

        expect(fs.existsSync(path.join(worktreePath, 'a.txt'))).toBe(true);
        expect(fs.existsSync(path.join(worktreePath, '.gitignore'))).toBe(true);
        // `toContain` sobre la salida cruda compara STRINGS: git imprime separadores POSIX y
        // el nombre largo, mientras `worktreePath` viene del tmpdir en 8.3 con backslashes.
        // Se afirma la propiedad real — git registra ESTE worktree en ESTA branch — con la
        // misma función que usa el producto.
        expect(ownedWorktreeExists(planRoot, worktreePath, 'awm-track/x')).toBe(true);
    });

    test('CRITICAL fix: baseSha SIN .gitignore de .awm pero el HEAD vivo del plan SÍ lo tiene — la comprobación vieja (contra planRoot) mentía "ignorado"; la nueva (contra el worktree) detecta que NO lo está y limpia el worktree que acaba de crear (C2)', () => {
        // baseSha = el commit ANTES de que el plan declare `.awm/` ignorado.
        const baseSha = commitFile(planRoot, 'a.txt', 'contenido');
        // El HEAD VIVO del plan avanza y agrega el .gitignore DESPUÉS de baseSha.
        commitFile(planRoot, '.gitignore', '.awm/\n');

        // Demuestra la premisa exacta del bug: preguntarle al repo del plan en
        // su HEAD vivo dice "ignorado" — pero el worktree que se va a crear
        // está checkeado en `baseSha`, que NO tiene ese `.gitignore`.
        expect(isAwmGitignored(planRoot)).toBe(true);

        const runtime = defaultTrackRuntime(planRoot, 'main');
        const ref = trackRef(worktreePath);

        expect(() => runtime.addWorktree(planRoot, ref, baseSha)).toThrow(/no está gitignoreado/);

        // C2: el worktree es NUESTRO (lo acabamos de crear en esta misma
        // llamada) — se descarta, nunca queda vivo e inseguro.
        expect(fs.existsSync(worktreePath)).toBe(false);
        const list = execFileSync('git', ['worktree', 'list'], { cwd: planRoot, encoding: 'utf8' });
        expect(list).not.toContain(worktreePath);

        // Prueba directa de que el worktree recién creado (checkeado en
        // baseSha) efectivamente NO tenía el .gitignore, confirmando que la
        // única forma honesta de responder es mirar el worktree, no el plan.
        const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-runtime-probe-'));
        fs.rmdirSync(probe);
        try {
            execFileSync('git', ['worktree', 'add', probe, baseSha], { cwd: planRoot, stdio: 'pipe' });
            expect(isAwmGitignored(probe)).toBe(false);
        } finally {
            try { execFileSync('git', ['worktree', 'remove', '--force', probe], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
            fs.rmSync(probe, { recursive: true, force: true });
        }
    });

    test('destino no vacío nunca se adopta (R4.6): addOwnedWorktree real rechaza sin siquiera llegar al chequeo de gitignore', () => {
        const baseSha = commitFile(planRoot, 'a.txt', 'contenido');
        fs.mkdirSync(worktreePath, { recursive: true });
        fs.writeFileSync(path.join(worktreePath, 'foreign.txt'), 'ajeno');
        const runtime = defaultTrackRuntime(planRoot, 'main');
        const ref = trackRef(worktreePath);

        expect(() => runtime.addWorktree(planRoot, ref, baseSha)).toThrow(/no vacío/);
        expect(fs.existsSync(path.join(worktreePath, 'foreign.txt'))).toBe(true);   // nunca tocado
        const list = execFileSync('git', ['worktree', 'list'], { cwd: planRoot, encoding: 'utf8' });
        expect(list).not.toContain(worktreePath);
    });

    test('initTrackJournal real: crea journal + descriptor en el worktree, y jamás pisa un trackContext ajeno preexistente (R4.6)', () => {
        commitFile(planRoot, '.gitignore', '.awm/\n');
        const baseSha = commitFile(planRoot, 'a.txt', 'contenido');
        const runtime = defaultTrackRuntime(planRoot, 'main');
        const ref = trackRef(worktreePath, { branch: 'awm-track/x' });
        runtime.addWorktree(planRoot, ref, baseSha);

        const context: TrackContext = { trackId: 'x', taskIds: [], planDigest: '', baseSha, planJournalId: 'j-plan-1' };
        expect(() => runtime.initTrackJournal(ref, context)).not.toThrow();
        expect(fs.existsSync(path.join(worktreePath, '.awm', 'track.json'))).toBe(true);

        // Un trackContext AJENO preexistente (otro trackId) nunca se sobreescribe.
        const foreignRef = trackRef(worktreePath, { trackId: 'y', branch: 'awm-track/x' });
        const foreignContext: TrackContext = { trackId: 'y', taskIds: [], planDigest: '', baseSha, planJournalId: 'j-plan-1' };
        expect(() => runtime.initTrackJournal(foreignRef, foreignContext)).toThrow(/pertenece a otro track/);
    });
});
