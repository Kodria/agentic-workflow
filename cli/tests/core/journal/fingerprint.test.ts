import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawn } from 'child_process';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

describe('computeFingerprint', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-fp-'));
        git(repo, 'init', '-q');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'uno');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c1');
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('mismo comando + mismo arbol + mismo cwd => mismo fingerprint (R3.4)', () => {   // verifies R3.4
        const a = computeFingerprint(repo, ['npm', 'test'], [], '.');
        const b = computeFingerprint(repo, ['npm', 'test'], [], '.');
        expect(a.fingerprint).toBe(b.fingerprint);
        expect(a.commandDigest).toBe(b.commandDigest);
    });

    test('cambio en tracked, untracked o argv cambia el fingerprint (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        const mod = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(mod).not.toBe(base);
        git(repo, 'checkout', '-q', '--', '.');
        fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'x');
        const untracked = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(untracked).not.toBe(base);
        fs.rmSync(path.join(repo, 'nuevo.txt'));
        const otherCmd = computeFingerprint(repo, ['npm', 'run', 'lint'], [], '.').fingerprint;
        expect(otherCmd).not.toBe(base);
    });

    test('cambio staged-only altera el fingerprint — indice real hasheado (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        git(repo, 'add', 'a.txt');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'uno');   // worktree identico al base; SOLO el indice cambio
        const stagedOnly = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(stagedOnly).not.toBe(base);
    });

    test('cwd distinto altera el fingerprint; cwd fuera del repo se rechaza (R3.4)', () => {  // verifies R3.4
        fs.mkdirSync(path.join(repo, 'sub'));
        const root = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        const sub = computeFingerprint(repo, ['npm', 'test'], [], 'sub').fingerprint;
        expect(sub).not.toBe(root);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '../fuera')).toThrow(/cwd/);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '/abs')).toThrow(/cwd/);
    });

    test('cwd que escapa mediante symlink se rechaza antes de persistir o ejecutar', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-fp-outside-'));
        fs.symlinkSync(outside, path.join(repo, 'escape'));
        try {
            expect(() => computeFingerprint(repo, ['pwd'], [], 'escape')).toThrow(/symlink|fuera del repo/);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('la expansion de paths queda persistida y excluye .awm (R3.4)', () => {          // verifies R3.4
        fs.mkdirSync(path.join(repo, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'journal', 'state.json'), '{}');
        const r = computeFingerprint(repo, ['npm', 'test'], ['a.txt'], '.');
        expect(r.expandedPaths).toEqual(['a.txt']);
        const all = computeFingerprint(repo, ['npm', 'test'], [], '.');
        expect(all.expandedPaths.some((p) => p.startsWith('.awm/'))).toBe(false);
    });

    test('globs declarados distintos no comparten fingerprint aunque hoy expandan al mismo archivo', () => {
        const narrow = computeFingerprint(repo, ['npm', 'test'], ['a.txt'], '.');
        const broad = computeFingerprint(repo, ['npm', 'test'], ['*.txt'], '.');
        expect(narrow.expandedPaths).toEqual(broad.expandedPaths);
        expect(narrow.fingerprint).not.toBe(broad.fingerprint);
    });

    test('archivo con nombre no-ASCII: cambio de contenido SI altera el fingerprint (R3.4)', () => {  // verifies R3.4
        const name = 'café.txt';
        fs.writeFileSync(path.join(repo, name), 'v1');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c2');
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, name), 'v2-completely-different-content');
        const mod = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(mod).not.toBe(base);
    });

    test('repos con muchos archivos no truncan la salida de git (R3.4)', () => {  // verifies R3.4
        for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), `contenido-${i}`);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '.')).not.toThrow();
    });
});

/** Defense-in-depth (post-implementation-qa, follow-up a Task 20): el `git()`
 *  interno de este archivo backea `computeFingerprint`, invocado en CADA tick
 *  del supervisor via `FingerprintNow`/`computeGate` (job/gate.ts). Sin stdio
 *  explicito, `execFileSync` relayea el stderr de git hacia el stderr DEL
 *  SUPERVISOR (`inheritStderr`, el default de Node cuando no se pasa `stdio`)
 *  — si ese fd fuera un pipe roto/destruido, el relay mismo dispara un `write
 *  EPIPE` no catcheable (throw asincronico via el evento 'error' del stream,
 *  invisible a try/catch sincronico) que tumbaria TODO el proceso `awm watch`
 *  en el tick siguiente, no solo un job. Este test reproduce esa condicion
 *  contra el `dist/` compilado REAL: un hijo real con stdio pipe cuyos
 *  extremos el padre destruye, corriendo `computeFingerprint` contra un `git`
 *  stub que emite ruido a stderr en cada invocacion (simulando warnings/locale
 *  de un git real) — sin el fix, esto tumba al hijo; con el fix, sobrevive. */
describe('fingerprint.ts git(): stdio explicito evita inheritStderr hacia un pipe roto', () => {
    const DIST_ENTRY = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'core', 'journal', 'fingerprint.js');
    // `which` is POSIX-only and not reliably on PATH in a pwsh-shell windows-latest
    // runner even though Git for Windows is installed (Windows uses `where`). `where`
    // can print one match per line when git is reachable via more than one PATH
    // entry, so only the FIRST line is a valid single path to spawn directly — the
    // rest would make execFileSync try to exec a multi-line string as one path.
    const REAL_GIT = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0)!;

    beforeAll(() => {
        if (!fs.existsSync(DIST_ENTRY)) {
            throw new Error('dist ausente: corre `cd cli && npm run build` antes de este test (verifica el dist compilado real, no el source transpilado por ts-jest)');
        }
    });

    test('computeFingerprint sobrevive un git que escribe a stderr, corriendo en un hijo con stdio pipe destruido por su padre (regresion: inheritStderr de execFileSync sin stdio explicito)', async () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-fp-execfilesync-hardening-'));
        const repoDir = path.join(workDir, 'repo');
        fs.mkdirSync(repoDir);
        execFileSync(REAL_GIT, ['init', '-q'], { cwd: repoDir });
        execFileSync(REAL_GIT, ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'c1'], { cwd: repoDir });
        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'contenido');

        // git "real" que, ademas de delegar al git del sistema, tambien emite
        // algo en stderr en TODA invocacion — plausible en entornos reales
        // (locale warnings, hooks, etc.) y suficiente para ejercitar inheritStderr.
        const stubBin = path.join(workDir, 'git');
        fs.writeFileSync(stubBin, `#!/bin/sh\necho "warning: ruido de stderr" 1>&2\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });

        const outFile = path.join(workDir, 'out.txt');
        const childScript = path.join(workDir, 'child.js');
        fs.writeFileSync(childScript, `
            const fs = require('fs');
            const { computeFingerprint } = require(${JSON.stringify(DIST_ENTRY)});
            try {
                const result = computeFingerprint(${JSON.stringify(repoDir)}, ['npm', 'test'], [], '.');
                fs.writeFileSync(${JSON.stringify(outFile)}, 'RESULT:' + result.fingerprint);
            } catch (e) {
                fs.writeFileSync(${JSON.stringify(outFile)}, 'THREW:' + e.message);
            }
        `);
        const child = spawn(process.execPath, [childScript], {
            cwd: workDir,
            env: { ...process.env, PATH: `${workDir}:${process.env.PATH}` },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        // El patron exacto que causaba el crash original: el padre destruye
        // su extremo de los pipes del hijo, cerrando el read-end — cualquier
        // escritura del hijo a su propio stdout/stderr despues de esto EPIPE-ea.
        child.stdout?.destroy();
        child.stderr?.destroy();
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            child.on('exit', (code, signal) => resolve({ code, signal }));
        });
        expect(exit.signal).toBeNull();
        expect(exit.code).toBe(0);   // el hijo debe sobrevivir y salir limpio, NO crashear por EPIPE no catcheable
        const out = fs.readFileSync(outFile, 'utf8');
        expect(out.startsWith('RESULT:')).toBe(true);   // logica de negocio intacta: computeFingerprint devolvio normalmente
        fs.rmSync(workDir, { recursive: true, force: true });
    });
});
