import fs from 'fs';
import path from 'path';
import os from 'os';
import { fingerprint, partition, readBaseline, writeBaseline, buildBaseline } from '../../../src/commands/sensors/baseline';
import { SensorError } from '../../../src/commands/sensors/types';

const err = (over: Partial<SensorError> = {}): SensorError => ({
    file: 'lib/a.ts', rule: 'TS2345', message: 'Argument of type X', ...over,
});

describe('fingerprint', () => {
    it('is stable across line-number drift (digits masked)', () => {
        const a = fingerprint('typecheck', err({ message: 'a.ts line 199 — bad', line: 199 }));
        const b = fingerprint('typecheck', err({ message: 'a.ts line 412 — bad', line: 412 }));
        expect(a).toBe(b);
    });

    it('differs when file or rule differs', () => {
        const base = fingerprint('lint', err());
        expect(fingerprint('lint', err({ file: 'lib/b.ts' }))).not.toBe(base);
        expect(fingerprint('lint', err({ rule: 'TS9999' }))).not.toBe(base);
    });

    it('is STABLE across message wording changes when a rule id is present', () => {
        // Regression guard: a tool-version bump or rule-config tweak (e.g. adding
        // argsIgnorePattern) rewords the message. The fingerprint must NOT change,
        // or the entire baseline goes stale and reports false "new" findings.
        const base = fingerprint('lint', err({ message: "'x' is defined but never used." }));
        const reworded = fingerprint('lint', err({ message: "'x' is defined but never used. Allowed unused args must match /^_/u." }));
        expect(reworded).toBe(base);
    });

    it('falls back to the masked message when there is no rule id (generic sensor)', () => {
        const base = fingerprint('raw', { message: 'SENSOR[raw] something broke' });
        expect(fingerprint('raw', { message: 'SENSOR[raw] something else' })).not.toBe(base);
        // digits are still masked in the fallback path
        expect(fingerprint('raw', { message: 'err at 199' })).toBe(fingerprint('raw', { message: 'err at 412' }));
    });

    it('differs by sensor', () => {
        expect(fingerprint('typecheck', err())).not.toBe(fingerprint('lint', err()));
    });
});

describe('partition', () => {
    it('returns all errors as new when there is no accepted set', () => {
        const errors = [err(), err({ file: 'lib/b.ts' })];
        const { newErrors, suppressed } = partition('lint', errors, undefined);
        expect(newErrors).toHaveLength(2);
        expect(suppressed).toBe(0);
    });

    it('suppresses errors whose fingerprint is in the baseline', () => {
        const accepted = err();
        const fresh = err({ file: 'lib/new.ts' });
        const baseline = [fingerprint('lint', accepted)];
        const { newErrors, suppressed } = partition('lint', [accepted, fresh], baseline);
        expect(suppressed).toBe(1);
        expect(newErrors).toHaveLength(1);
        expect(newErrors[0].file).toBe('lib/new.ts');
    });

    it('counts occurrences: extra same-(file,rule) findings beyond the baseline budget are new', () => {
        // Baseline accepted 3 occurrences of the same (file, rule). The file now
        // has 5 → only the 2 beyond the accepted budget are new. This is the gap
        // that a plain Set of fingerprints would have missed (it would suppress
        // all 5). Messages vary to prove matching ignores wording.
        const occ = (msg: string) => err({ message: msg });
        const baseline = [
            fingerprint('lint', err()), fingerprint('lint', err()), fingerprint('lint', err()),
        ];
        const current = [occ('a'), occ('b'), occ('c'), occ('d'), occ('e')];
        const { newErrors, suppressed } = partition('lint', current, baseline);
        expect(suppressed).toBe(3);
        expect(newErrors).toHaveLength(2);
    });

    it('fixing findings below the baseline budget yields zero new', () => {
        const baseline = [fingerprint('lint', err()), fingerprint('lint', err())];
        const { newErrors, suppressed } = partition('lint', [err()], baseline);
        expect(suppressed).toBe(1);
        expect(newErrors).toHaveLength(0);
    });
});

describe('readBaseline / writeBaseline', () => {
    let cwd: string;
    beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bl-')); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true }); });

    it('returns null when no baseline file exists', () => {
        expect(readBaseline(cwd)).toBeNull();
    });

    it('returns null on a corrupt baseline file (does not throw)', () => {
        fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(cwd, '.awm', 'sensors.baseline.json'), '{ not json');
        expect(readBaseline(cwd)).toBeNull();
    });

    it('round-trips a baseline through write then read', () => {
        writeBaseline(cwd, { lint: ['abc'], typecheck: ['def'] });
        expect(readBaseline(cwd)).toEqual({ lint: ['abc'], typecheck: ['def'] });
    });
});

describe('buildBaseline', () => {
    it('maps each sensor to the fingerprints of its current findings', () => {
        const b = buildBaseline([
            { name: 'lint', errors: [err(), err({ file: 'lib/b.ts' })] },
            { name: 'typecheck', errors: [err()] },
        ]);
        expect(b.lint).toHaveLength(2);
        expect(b.typecheck).toHaveLength(1);
        expect(b.lint[0]).toBe(fingerprint('lint', err()));
    });
});
