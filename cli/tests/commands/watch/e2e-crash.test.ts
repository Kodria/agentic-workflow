import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFileSync, ChildProcess } from 'child_process';

jest.setTimeout(180000);

const CLI = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'index.js');

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function readState(repo: string): Record<string, unknown> | null {
    try { return JSON.parse(fs.readFileSync(path.join(repo, '.awm', 'journal', 'main', 'state.json'), 'utf8')); }
    catch { return null; }
}

async function until(fn: () => boolean, ms = 60000, label = 'condicion'): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${label}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

describe('E2E real: crash/restart del supervisor', () => {
    let repo: string;
    let stubBin: string;
    let env: NodeJS.ProcessEnv;
    const children: ChildProcess[] = [];

    beforeAll(() => {
        if (!fs.existsSync(CLI)) throw new Error('dist ausente: corre `cd cli && npm run build` antes de esta suite (Task 20 Step 1)');
    });

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-'));
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node -e "process.exit(0)"' } }));
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-bin-'));
        for (const name of ['codex', 'claude']) {
            fs.writeFileSync(path.join(stubBin, name), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        }
        env = { ...process.env, PATH: `${stubBin}:${process.env.PATH}` };
        execFileSync(process.execPath, [CLI, 'watch', '--init'], { cwd: repo, env });
    });

    afterEach(() => {
        // higiene: terminar TODO grupo que hayamos originado (supervisores,
        // stubs de controlador, wrappers) — cero huerfanos entre tests
        const s = readState(repo);
        const groups = new Set<number>();
        for (const c of children) { if (c.pid !== undefined) groups.add(c.pid); }
        if (s !== null) {
            for (const g of (s.generations as Array<{ processRef?: { processGroup: number } }>) ?? []) {
                if (g.processRef !== undefined) groups.add(g.processRef.processGroup);
            }
            for (const j of Object.values((s.jobs as Record<string, { processRef?: { processGroup: number } }>) ?? {})) {
                if (j.processRef !== undefined) groups.add(j.processRef.processGroup);
            }
        }
        for (const pgid of groups) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* ya muerto */ } }
        children.length = 0;
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    function startSupervisor(provider: string): ChildProcess {
        const out = fs.openSync(path.join(repo, `sup-${children.length}.log`), 'a');
        const child = spawn(process.execPath, [CLI, 'watch', '--provider', provider], {
            cwd: repo, env, detached: true, stdio: ['ignore', out, out],
        });
        children.push(child);
        child.unref();
        return child;
    }

    test('SIGKILL a mitad de job: el wrapper sobrevive, el resultado llega, el restart adopta sin duplicar (R1.8/R4.1/R4.4)', async () => {  // verifies R1.8
        const sup1 = startSupervisor('codex');
        const lockPath = path.join(fs.realpathSync(repo), '.awm', 'journal', 'supervisor.lock');
        await until(() => fs.existsSync(lockPath), 30000, 'lock del supervisor 1');
        await until(() => {
            const s = readState(repo);
            return s !== null && (s.generations as Array<{ state: string; token: string }>).some((g) => g.state === 'active');
        }, 30000, 'generacion activa');
        const token = (readState(repo)!.generations as Array<{ state: string; token: string }>).find((g) => g.state === 'active')!.token;
        // job largo: sobrevive de sobra al SIGKILL del supervisor
        execFileSync(process.execPath, [CLI, 'job', 'request', '--generation', token, '--',
            'node', '-e', 'setTimeout(()=>process.exit(0), 8000)'], { cwd: repo, env });
        await until(() => {
            const s = readState(repo);
            if (s === null) return false;
            return Object.values(s.jobs as Record<string, { executionState: string }>).some((j) => j.executionState === 'running');
        }, 60000, 'job running con identidad real');
        // CRASH REAL a mitad del job
        process.kill(sup1.pid!, 'SIGKILL');
        const jobs = readState(repo)!.jobs as Record<string, { spawnNonce: string }>;
        const jobId = Object.keys(jobs)[0];
        const nonce = jobs[jobId].spawnNonce;
        const resultFile = path.join(repo, '.awm', 'journal', 'main', 'logs', `${jobId}.${nonce}.result.json`);
        // (c) el wrapper EXTERNO sobrevive al supervisor muerto y deja el resultado
        await until(() => fs.existsSync(resultFile), 60000, 'result sidecar con supervisor muerto');
        expect(JSON.parse(fs.readFileSync(resultFile, 'utf8')).exitCode).toBe(0);
        // (d) restart: reclama lock muerto y ADOPTA el resultado sin duplicar
        startSupervisor('codex');
        await until(() => {
            const s = readState(repo);
            if (s === null) return false;
            const j = (s.jobs as Record<string, { executionState: string; verdict?: string }>)[jobId];
            return j !== undefined && j.executionState === 'exited' && j.verdict === 'pass';
        }, 60000, 'adopcion del resultado');
        const finalJobs = readState(repo)!.jobs as Record<string, { executionState: string; attemptOf?: string }>;
        expect(Object.keys(finalJobs)).toHaveLength(1);                       // sin duplicacion
        expect(Object.values(finalJobs).some((j) => j.attemptOf !== undefined)).toBe(false);  // sin attempt fantasma
    });

    test('adapter claude-code lanza el stub claude; SIGTERM limpia y libera el lock (R4.8/R2.4)', async () => {  // verifies R4.8
        const sup = startSupervisor('claude-code');
        const lockPath = path.join(fs.realpathSync(repo), '.awm', 'journal', 'supervisor.lock');
        await until(() => fs.existsSync(lockPath), 30000, 'lock');
        await until(() => {
            const s = readState(repo);
            if (s === null) return false;
            const gen = (s.generations as Array<{ state: string; processRef?: { pid: number } }>).find((g) => g.state === 'active');
            if (gen?.processRef === undefined) return false;
            try {
                const args = execFileSync('ps', ['-o', 'args=', '-p', String(gen.processRef.pid)], { encoding: 'utf8' });
                return args.includes('claude');
            } catch { return false; }
        }, 30000, 'stub claude lanzado por el adapter');
        process.kill(sup.pid!, 'SIGTERM');                     // handler de senial: libera lock y sale
        await until(() => !fs.existsSync(lockPath), 30000, 'lock liberado tras SIGTERM');
    });
});
