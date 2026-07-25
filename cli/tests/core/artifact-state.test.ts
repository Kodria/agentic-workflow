import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    ManagedArtifactRecord,
    artifactStateFile,
    readArtifactState,
    writeArtifactState,
} from '../../src/core/artifact-state';

describe('artifact-state', () => {
    let tmpHome: string;
    let stateFile: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        // Per CLAUDE.md: no test may touch the real ~/.awm — isolate HOME/AWM_HOME.
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-artifact-state-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        stateFile = path.join(tmpHome, '.awm', 'state', 'artifacts.json');
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function record(name: string, targetPath: string, owners: ManagedArtifactRecord['owners']): ManagedArtifactRecord {
        return {
            name,
            type: 'skill',
            scope: 'global',
            targetPath,
            sourcePath: path.join(tmpHome, 'registry', 'skills', name),
            renderer: 'link',
            owners,
        };
    }

    describe('artifactStateFile', () => {
        it('resolves under AWM_HOME/state/artifacts.json', () => {
            expect(artifactStateFile()).toBe(stateFile);
        });
    });

    describe('readArtifactState', () => {
        it('returns [] when the file does not exist', () => {
            expect(fs.existsSync(stateFile)).toBe(false);
            expect(readArtifactState(stateFile)).toEqual([]);
        });

        it('throws a clear error on invalid JSON', () => {
            fs.mkdirSync(path.dirname(stateFile), { recursive: true });
            fs.writeFileSync(stateFile, '{ not json');
            expect(() => readArtifactState(stateFile)).toThrow(/not valid JSON/);
        });

        it('throws when the parsed content is not an array', () => {
            fs.mkdirSync(path.dirname(stateFile), { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify({ foo: 'bar' }));
            expect(() => readArtifactState(stateFile)).toThrow(/must contain an array/);
        });

        it('defaults to artifactStateFile() when no file is given', () => {
            expect(readArtifactState()).toEqual([]);
        });
    });

    describe('writeArtifactState / round-trip', () => {
        it('round-trips records written then read back', () => {
            const records = [
                record('development-process', path.join(tmpHome, '.agents/skills/development-process'), ['opencode', 'codex']),
            ];
            writeArtifactState(records, stateFile);
            expect(readArtifactState(stateFile)).toEqual(records);
        });

        it('sorts output by targetPath deterministically regardless of input order', () => {
            const b = record('b-skill', path.join(tmpHome, '.agents/skills/b-skill'), ['codex']);
            const a = record('a-skill', path.join(tmpHome, '.agents/skills/a-skill'), ['codex']);
            const c = record('c-skill', path.join(tmpHome, '.agents/skills/c-skill'), ['codex']);

            writeArtifactState([b, c, a], stateFile);
            const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            expect(persisted.map((r: ManagedArtifactRecord) => r.targetPath)).toEqual([
                a.targetPath,
                b.targetPath,
                c.targetPath,
            ]);
            expect(readArtifactState(stateFile)).toEqual([a, b, c]);
        });

        it('creates the state directory if missing and writes with restrictive mode', () => {
            expect(fs.existsSync(path.dirname(stateFile))).toBe(false);
            writeArtifactState([record('s', path.join(tmpHome, '.agents/skills/s'), ['codex'])], stateFile);
            expect(fs.existsSync(stateFile)).toBe(true);
            expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
        });
    });
});
