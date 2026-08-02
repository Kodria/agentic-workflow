import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerJobCommand } from '../../../src/commands/job';
import { initJournal, readJournal } from '../../../src/core/journal/store';
import { emitRequest, listPendingRequests } from '../../../src/core/journal/requests';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { computeGate } from '../../../src/commands/job/gate';

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

// Regresion adversarial reviewer (post-624a4c0): 624a4c0 hizo verdictId
// generation-scoped pero DEJO idempotencyKey sin generation. Como
// payloadDigest se computa sobre TODO el payload (que embebe verdictId), un
// segundo veredicto con MISMA obligacion/result/detail pero OTRA generation
// (ej. controller crasheo y relanzo con nuevo generationToken entre dos
// submits — ver watch/generations.ts beginGeneration, esto pasa en CADA
// relanzamiento) produce: MISMA idempotencyKey (no incluia generation) pero
// payloadDigest DISTINTO (verdictId si difiere) => cae al chequeo proactivo
// de Fix 1 en consumePendingRequests y se rechaza como
// rejected-digest-mismatch en vez de aplicarse como el veredicto
// genuinamente nuevo y distinto que en realidad es — socavando directamente
// Fix 2 (cierre de FixObligation en re-review pass) si el pass llega bajo
// otra generation que el fail original.
describe('verdict idempotencyKey alineada en scope con verdictId (regresion adversarial reviewer)', () => {
    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-verdict-scope-'));
        gitInit(repo);
        initJournal(repo, 'rama');
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'reg-e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [], reviewObligations: [{ id: 'o1', kind: 'spec' }] },
        });
        consumePendingRequests(repo, 'rama', 'g0');
    });

    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('ESCENARIO EXACTO del reviewer: fail bajo g1 abre un fix que bloquea el gate; el MISMO veredicto (obligacion/result/detail) reenviado bajo g2 se APLICA, no se rechaza por digest-mismatch', async () => {
        const fpNull = () => null;

        const a = await run(['verdict', '--generation', 'g1', '--obligation', 'o1', '--result', 'fail', '--detail', 'rompe X'], repo);
        expect(a.error).toBeNull();
        const out1 = consumePendingRequests(repo, 'rama', 'g1');
        expect(out1).toEqual({ applied: 1, rejectedStale: 0, rejectedDigest: 0, rejectedInvalid: 0, corrupt: 0 });

        let s = readJournal(repo, 'rama').state!;
        const verdictIdFail = JSON.parse(a.out).verdictId as string;
        expect(s.fixes.find((f) => f.verdictId === verdictIdFail)!.closed).toBe(false);
        expect(computeGate(s, false, fpNull).reasons.some((r) => r.category === 'open-fix')).toBe(true);

        // controller crashea y relanza (beginGeneration produce un token nuevo) —
        // reenvia el MISMO veredicto (misma obligacion/result/detail) bajo g2.
        const b = await run(['verdict', '--generation', 'g2', '--obligation', 'o1', '--result', 'fail', '--detail', 'rompe X'], repo);
        expect(b.error).toBeNull();
        const out2 = consumePendingRequests(repo, 'rama', 'g2');
        expect(out2.rejectedDigest).toBe(0);   // <- ANTES del fix: esto era 1 (rejected-digest-mismatch espurio)
        expect(out2).toEqual({ applied: 1, rejectedStale: 0, rejectedDigest: 0, rejectedInvalid: 0, corrupt: 0 });

        s = readJournal(repo, 'rama').state!;
        expect(s.verdicts).toHaveLength(2);   // el segundo veredicto, genuinamente distinto, quedo registrado
    });

    test('un veredicto PASS reenviado bajo OTRA generation que el fail original sigue cerrando el fix (Fix2 sobrevive al alineado de scope)', async () => {
        const fpNull = () => null;

        const a = await run(['verdict', '--generation', 'g1', '--obligation', 'o1', '--result', 'fail', '--detail', 'rompe X'], repo);
        consumePendingRequests(repo, 'rama', 'g1');
        const verdictIdFail = JSON.parse(a.out).verdictId as string;

        const b = await run(['verdict', '--generation', 'g2', '--obligation', 'o1', '--result', 'pass', '--detail', 'arreglado'], repo);
        expect(b.error).toBeNull();
        const out2 = consumePendingRequests(repo, 'rama', 'g2');
        expect(out2).toEqual({ applied: 1, rejectedStale: 0, rejectedDigest: 0, rejectedInvalid: 0, corrupt: 0 });

        const s = readJournal(repo, 'rama').state!;
        expect(s.fixes.find((f) => f.verdictId === verdictIdFail)!.closed).toBe(true);
        expect(computeGate(s, false, fpNull).reasons.some((r) => r.category === 'open-fix')).toBe(false);
    });
});
