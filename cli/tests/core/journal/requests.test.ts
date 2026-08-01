import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { emitRequest, listPendingRequests, applyOutcome, ackFor } from '../../../src/core/journal/requests';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { requestsDir } from '../../../src/core/journal/paths';

// Bootstrap para invocar el codigo REAL de src/ (.ts) desde procesos `node`
// separados sin depender de un build previo (dist/ esta gitignored) ni de
// ts-node (no instalado): registra un require.extensions['.ts'] que
// transpila on-demand via el compilador de TypeScript (devDependency ya
// presente). NODE_PATH apunta a cli/node_modules para que el propio script
// bootstrap pueda resolver 'typescript' aunque viva fuera del arbol del repo.
const CLI_ROOT = path.resolve(__dirname, '../../..');
const REQUESTS_TS = path.join(CLI_ROOT, 'src/core/journal/requests.ts');
const TS_BOOTSTRAP = `
const fs = require('fs');
const ts = require('typescript');
require.extensions['.ts'] = function (mod, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        fileName: filename,
    });
    mod._compile(outputText, filename);
};
`;

function runInSeparateProcess(script: string, args: string[]): string {
    const scriptFile = path.join(os.tmpdir(), `awm-cross-proc-${crypto.randomUUID()}.js`);
    fs.writeFileSync(scriptFile, TS_BOOTSTRAP + script);
    try {
        return execFileSync('node', [scriptFile, ...args], {
            encoding: 'utf8',
            env: { ...process.env, NODE_PATH: path.join(CLI_ROOT, 'node_modules') },
        }).trim();
    } finally {
        fs.rmSync(scriptFile, { force: true });
    }
}

describe('requests', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-req-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('emitRequest publica atomico: nunca hay .tmp visible como pendiente (R1.3)', () => {  // verifies R1.3
        const r = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: { argv: ['npm', 'test'] } });
        expect(r.requestId).toMatch(/^req-/);
        const files = fs.readdirSync(requestsDir(repo, 'rama'));
        expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
        expect(listPendingRequests(repo, 'rama')).toHaveLength(1);
    });

    test('request con secreto literal se rechaza sin persistir (R2.3 via emisor)', () => {  // verifies R2.3
        expect(() => emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k2', payload: { argv: ['x', '--token', 'abc'] } }))
            .toThrow(/secreto literal/);
        expect(listPendingRequests(repo, 'rama')).toHaveLength(0);
    });

    test('idempotencyKey repetida: digest distinto se rechaza; mismo digest registra ALIAS con el mismo resultRef (R1.3)', () => {  // verifies R1.3
        const r1 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'test'] } });
        let s = readJournal(repo, 'rama').state!;
        s = applyOutcome(s, { requestId: r1.requestId, idempotencyKey: r1.idempotencyKey, payloadDigest: r1.payloadDigest, outcome: 'applied', resultRef: 'job-1' });
        writeJournal(repo, 'rama', s);
        // ack perdido en disco: se regenera desde state.json
        expect(ackFor(readJournal(repo, 'rama').state!, r1.requestId)!.resultRef).toBe('job-1');
        // misma key + MISMO payload => alias: el requestId nuevo tiene SU entrada con el mismo resultRef
        const r2 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'test'] } });
        const s2 = readJournal(repo, 'rama').state!;
        applyOutcome(s2, { requestId: r2.requestId, idempotencyKey: 'k3', payloadDigest: r2.payloadDigest, outcome: 'applied' });
        expect(ackFor(s2, r2.requestId)).not.toBeNull();
        expect(ackFor(s2, r2.requestId)!.resultRef).toBe('job-1');   // alias regenerable (bloqueador 4)
        // misma key, payload distinto => rechazo explicito
        const r3 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k3', payload: { argv: ['npm', 'run', 'otro'] } });
        expect(() => applyOutcome(s2, { requestId: r3.requestId, idempotencyKey: 'k3', payloadDigest: r3.payloadDigest, outcome: 'applied' }))
            .toThrow(/digest/);
    });

    test('replay del MISMO requestId es no-op (R1.3)', () => {              // verifies R1.3
        const s = readJournal(repo, 'rama').state!;
        applyOutcome(s, { requestId: 'req-x', idempotencyKey: 'kx', payloadDigest: 'd', outcome: 'applied', resultRef: 'job-9' });
        applyOutcome(s, { requestId: 'req-x', idempotencyKey: 'kx', payloadDigest: 'd', outcome: 'applied', resultRef: 'job-9' });
        expect(Object.keys(s.appliedRequests)).toHaveLength(1);
    });

    test('emitRequest preserva orden de emision incluso con Date.now() colisionado (RNF-T.7)', () => {  // verifies R1.3
        const originalNow = Date.now;
        Date.now = () => 1700000000000;
        try {
            const a = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'ka', payload: { argv: ['npm', 'test'] } });
            const b = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'kb', payload: { argv: ['npm', 'test'] } });
            const listed = listPendingRequests(repo, 'rama').map((p) => p.requestId);
            expect(listed.indexOf(a.requestId)).toBeLessThan(listed.indexOf(b.requestId));
        } finally {
            Date.now = originalNow;
        }
    });

    test('emitRequest preserva orden causal entre procesos SEPARADOS (RNF-T.7)', () => {  // verifies R1.3
        // El propio directorio de requests YA fue inicializado por initJournal
        // en beforeEach (mismo proceso jest); lo que importa es que emitRequest
        // A y B corran en procesos `node` DISTINTOS, uno tras otro.
        const emitScript = `
            const { emitRequest } = require(${JSON.stringify(REQUESTS_TS)});
            const [, , repoArg, keyArg] = process.argv;
            const r = emitRequest(repoArg, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: keyArg, payload: { argv: ['npm', 'test'] } });
            console.log(r.requestId);
        `;
        const idA = runInSeparateProcess(emitScript, [repo, 'proc-a']);
        const idB = runInSeparateProcess(emitScript, [repo, 'proc-b']);
        const listed = listPendingRequests(repo, 'rama').map((p) => p.requestId);
        expect(listed.indexOf(idA)).toBeLessThan(listed.indexOf(idB));
    });
});
