import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerJobCommand } from '../../../src/commands/job';
import { initJournal } from '../../../src/core/journal/store';
import { listPendingRequests } from '../../../src/core/journal/requests';

// Fix 3 (post-implementation-qa): `job verdict`'s verdictId era
// Date.now()+random en cada invocacion aunque idempotencyKey ya era
// determinista — un retry legitimo del MISMO comando producia un payload
// distinto (verdictId distinto => payloadDigest distinto) y, tras Fix 1,
// caia a rejected-digest-mismatch en vez de reconocerse como el mismo alias.
// Esto prueba el comando CLI REGISTRADO (no la logica interna de apply.ts):
// invocaciones identicas producen el MISMO verdictId, byte-identico.

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', 'rama'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
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

describe('`job verdict` verdictId determinista (Fix 3)', () => {
    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-verdict-cli-'));
        gitInit(repo);
        initJournal(repo, 'rama');
    });

    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('dos invocaciones identicas producen el MISMO verdictId', async () => {
        const args = ['verdict', '--generation', 'g1', '--obligation', 'o1', '--result', 'fail', '--detail', 'rompe X'];
        const a = await run(args, repo);
        const b = await run(args, repo);
        expect(a.error).toBeNull();
        expect(b.error).toBeNull();
        const verdictIdA = JSON.parse(a.out).verdictId;
        const verdictIdB = JSON.parse(b.out).verdictId;
        expect(verdictIdA).toBe(verdictIdB);

        // ademas: mismo idempotencyKey Y mismo payloadDigest (byte-identico) para
        // ambas requests emitidas — un retry real, no un digest-mismatch espurio.
        const pending = listPendingRequests(repo, 'rama').filter((p) => !p.corrupt);
        expect(pending).toHaveLength(2);
        expect(pending[0].envelope.idempotencyKey).toBe(pending[1].envelope.idempotencyKey);
        expect(JSON.stringify(pending[0].envelope.payload)).toBe(JSON.stringify(pending[1].envelope.payload));
    });

    test('generation distinta produce un verdictId distinto (evita colision entre generaciones)', async () => {
        const a = await run(['verdict', '--generation', 'g1', '--obligation', 'o1', '--result', 'fail', '--detail', 'x'], repo);
        const b = await run(['verdict', '--generation', 'g2', '--obligation', 'o1', '--result', 'fail', '--detail', 'x'], repo);
        expect(JSON.parse(a.out).verdictId).not.toBe(JSON.parse(b.out).verdictId);
    });
});
