import { renderReport, runDoctor } from '../../src/commands/doctor';
import type { CheckReport } from '../../src/core/diagnostics/types';
import fs from 'fs';
import os from 'os';
import path from 'path';

function report(partial: Partial<CheckReport> = {}): CheckReport {
    return {
        results: [
            { id: 'machine.cli', level: 'machine', label: 'CLI v1.0.0', status: 'ok', remedy: { kind: 'none' } },
            { id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'missing',
                remedy: { kind: 'command', value: 'awm init' } },
        ],
        overall: 'degraded',
        hasProject: false,
        ...partial,
    };
}

describe('renderReport', () => {
    it('renders the machine block with glyphs and remedies', () => {
        const out = renderReport(report());
        expect(out).toContain('AWM · estado del harness');
        expect(out).toContain('Máquina (global)');
        expect(out).toContain('✔ CLI v1.0.0');
        expect(out).toContain('✖ hook SessionStart');
        expect(out).toContain('→ awm init');
        expect(out).toContain('estado: degradado · 1 acciones sugeridas');
    });

    it('omits the project block and shows a hint when hasProject is false', () => {
        const out = renderReport(report());
        expect(out).toContain('(sin proyecto en el cwd)');
        expect(out).not.toContain('Proyecto:');
    });

    it('renders the project block titled with projectName', () => {
        const out = renderReport(report({
            hasProject: true,
            projectName: 'belanz',
            results: [
                { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md ausente',
                    status: 'missing', remedy: { kind: 'skill', value: 'project-constitution' } },
            ],
        }));
        expect(out).toContain('Proyecto: belanz');
        expect(out).toContain('→ skill: project-constitution');
    });
});

describe('runDoctor', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-run-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('returns exit code 1 when the harness is degraded (bare HOME, no project)', () => {
        const code = runDoctor({ cwd: tmpHome });
        expect(code).toBe(1);
    });

    it('--json emits a parseable CheckReport and keeps the same exit code', () => {
        const code = runDoctor({ cwd: tmpHome, json: true });
        const written = writeSpy.mock.calls.map((c) => c[0]).join('');
        const parsed = JSON.parse(written);
        expect(parsed.overall).toBe('degraded');
        expect(Array.isArray(parsed.results)).toBe(true);
        expect(code).toBe(1);
    });
});
