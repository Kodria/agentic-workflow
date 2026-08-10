import fs from 'fs';
import path from 'path';
import os from 'os';
import { initJournal, readJournal, writeJournal, appendEvent } from '../../../src/core/journal/store';
import { statePath, journalDir, eventsPath } from '../../../src/core/journal/paths';

describe('journal store', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-store-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('initJournal crea 0700/0600 y estado inicial valido (R1.2)', () => {  // verifies R1.2
        initJournal(repo, 'rama');
        const dir = journalDir(repo, 'rama');
        // Windows fs.chmod can only toggle the read-only attribute, not set granular
        // POSIX bits -- see tests/core/atomic-file.test.ts (files, confirmed against
        // real windows-latest CI) and tests/core/install-transaction.test.ts
        // (directories, same reasoning) for the 0o666/0o777 shapes.
        // Confirmed against real windows-latest CI (2026-08-08): directories get the same
        // 0o666 shape as files there, not 0o777 as first reasoned.
        expect(fs.statSync(dir).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o700);
        expect(fs.statSync(statePath(repo, 'rama')).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600);
        const r = readJournal(repo, 'rama');
        expect(r.corrupt).toBe(false);
        expect(r.state!.revision).toBe(0);
    });

    test('writeJournal incrementa revision y rechaza revision vieja (R1.2)', () => {  // verifies R1.2
        initJournal(repo, 'rama');
        const s1 = readJournal(repo, 'rama').state!;
        writeJournal(repo, 'rama', s1);                       // rev 0 -> 1
        const s2 = readJournal(repo, 'rama').state!;
        expect(s2.revision).toBe(1);
        expect(() => writeJournal(repo, 'rama', s1)).toThrow(/revision/);  // CAS: s1 quedo vieja
    });

    test('nextAction persiste estructurado (R1.5)', () => {                // verifies R1.5
        initJournal(repo, 'rama');
        const s = readJournal(repo, 'rama').state!;
        s.cycle.nextAction = { actionId: 'a1', type: 'implement-task', target: 'T1', preconditions: [], attempt: 1, state: 'pending' };
        writeJournal(repo, 'rama', s);
        expect(readJournal(repo, 'rama').state!.cycle.nextAction!.actionId).toBe('a1');
    });

    test('estado corrupto se reporta, jamas se descarta en silencio (R1.6)', () => {  // verifies R1.6
        initJournal(repo, 'rama');
        fs.writeFileSync(statePath(repo, 'rama'), 'null');    // JSON valido, shape invalido
        const r = readJournal(repo, 'rama');
        expect(r.corrupt).toBe(true);
        expect(r.state).toBeNull();
        fs.writeFileSync(statePath(repo, 'rama'), '{roto');   // sintaxis invalida
        expect(readJournal(repo, 'rama').corrupt).toBe(true);
    });

    test('normaliza campos aditivos de snapshots schema 1 sin certificar evidencia legacy', () => {
        initJournal(repo, 'rama');
        const legacy = readJournal(repo, 'rama').state! as unknown as Record<string, unknown>;
        delete legacy.requestProblems;
        delete legacy.custodyDecisions;
        delete (legacy.cycle as Record<string, unknown>).nextAction;
        (legacy.verdicts as unknown[]).push({ id: 'v-old', obligationId: 'o-old', result: 'pass', detail: 'legacy', receivedAt: new Date().toISOString() });
        fs.writeFileSync(statePath(repo, 'rama'), JSON.stringify(legacy));
        const read = readJournal(repo, 'rama');
        expect(read.corrupt).toBe(false);
        expect(read.state!.requestProblems).toEqual([]);
        expect(read.state!.cycle.nextAction?.actionId).toBe('bootstrap-cycle');
        expect(read.state!.verdicts[0]).toEqual(expect.objectContaining({ fingerprint: '', argv: [], paths: [], cwd: '.' }));
    });

    test('appendEvent agrega lineas de auditoria best-effort (R4.6)', () => {  // verifies R4.6
        initJournal(repo, 'rama');
        appendEvent(repo, 'rama', { kind: 'generation-launched', n: 1 });
        appendEvent(repo, 'rama', { kind: 'request-rejected-stale' });
        const lines = fs.readFileSync(eventsPath(repo, 'rama'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).kind).toBe('generation-launched');
        expect(typeof JSON.parse(lines[0]).at).toBe('string');
    });

    test('writeJournal rechaza un estado propuesto con forma invalida, nunca lo persiste (R1.6)', () => {  // verifies R1.6
        initJournal(repo, 'rama');
        const s = readJournal(repo, 'rama').state!;
        const malformed = { ...s } as unknown as Record<string, unknown>;
        delete malformed.tasks;
        expect(() => writeJournal(repo, 'rama', malformed as any)).toThrow(/forma invalida/);
        // el journal sigue intacto y legible tras el intento rechazado
        const after = readJournal(repo, 'rama');
        expect(after.corrupt).toBe(false);
        expect(after.state!.revision).toBe(s.revision);
    });

    test('writeJournal rechaza un estado cuyo branch no coincide con el branch destino (R1.2)', () => {  // verifies R1.2
        initJournal(repo, 'rama');
        const s = readJournal(repo, 'rama').state!;
        const wrongBranch = { ...s, branch: 'otra-rama' };
        expect(() => writeJournal(repo, 'rama', wrongBranch)).toThrow(/branch/);
    });

    test('schema 1 legacy recibe journalId determinista sin perder evidencia (R9.3)', () => {  // verifies R9.3
        initJournal(repo, 'legacy');
        const legacy = readJournal(repo, 'legacy').state! as unknown as Record<string, unknown>;
        delete legacy.journalId;
        fs.writeFileSync(statePath(repo, 'legacy'), JSON.stringify(legacy));
        const first = readJournal(repo, 'legacy').state!;
        const second = readJournal(repo, 'legacy').state!;
        expect(first.journalId).toBe(second.journalId);
        expect(first.journalId).toMatch(/^legacy-[0-9a-f]{32}$/);
    });

    test('journalId legacy materializado se persiste en la siguiente escritura CAS normal (R9.3)', () => {  // verifies R9.3
        initJournal(repo, 'legacy2');
        const legacy = readJournal(repo, 'legacy2').state! as unknown as Record<string, unknown>;
        delete legacy.journalId;
        fs.writeFileSync(statePath(repo, 'legacy2'), JSON.stringify(legacy));
        const read = readJournal(repo, 'legacy2').state!;
        // la lectura por si sola sigue siendo read-only: el disco AUN no tiene journalId
        expect(JSON.parse(fs.readFileSync(statePath(repo, 'legacy2'), 'utf8')).journalId).toBeUndefined();
        writeJournal(repo, 'legacy2', read);
        const onDisk = JSON.parse(fs.readFileSync(statePath(repo, 'legacy2'), 'utf8'));
        expect(onDisk.journalId).toBe(read.journalId);
    });

    test('normalizeSchemaOne no inventa tracks/trackContext para un journal legacy que nunca los tuvo (R9.2)', () => {
        initJournal(repo, 'legacy3');
        const read = readJournal(repo, 'legacy3').state!;
        expect(read.tracks).toBeUndefined();
        expect(read.trackContext).toBeUndefined();
    });
});
