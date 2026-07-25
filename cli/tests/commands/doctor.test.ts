import { renderReport, runDoctor } from '../../src/commands/doctor';
import type { CheckReport } from '../../src/core/diagnostics/types';
import type { AwmPreferences } from '../../src/utils/config';
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
        expect(out).toContain('AWM · harness status');
        expect(out).toContain('Machine (global)');
        expect(out).toContain('✔ CLI v1.0.0');
        expect(out).toContain('✖ hook SessionStart');
        expect(out).toContain('→ awm init');
        expect(out).toContain('status: degraded · 1 suggested actions');
    });

    it('omits the project block and shows a hint when hasProject is false', () => {
        const out = renderReport(report());
        expect(out).toContain('(no project in cwd)');
        expect(out).not.toContain('Proyecto:');
    });

    it('renders the detail field in parentheses when present', () => {
        const out = renderReport(report({
            results: [
                { id: 'machine.cli', level: 'machine', label: 'CLI v1.2.0', status: 'warn',
                    detail: 'cache out of date', remedy: { kind: 'command', value: 'awm update' } },
            ],
        }));
        expect(out).toContain('CLI v1.2.0');
        expect(out).toContain('(cache out of date)');
        expect(out).toContain('→ awm update');
    });

    it('renders the project block titled with projectName', () => {
        const out = renderReport(report({
            hasProject: true,
            projectName: 'belanz',
            results: [
                { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md missing',
                    status: 'missing', remedy: { kind: 'skill', value: 'project-constitution' } },
            ],
        }));
        expect(out).toContain('Project: belanz');
        expect(out).toContain('→ skill: project-constitution');
    });
});

describe('runDoctor', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    function stdout(): string {
        return writeSpy.mock.calls.map((c) => c[0]).join('');
    }

    function prefsWith(enabledAgents: AwmPreferences['enabledAgents']): AwmPreferences {
        return {
            defaultAgent: enabledAgents[0],
            enabledAgents,
            installMethod: 'symlink',
            defaultScope: 'local',
        };
    }

    function writePrefs(prefs: AwmPreferences): void {
        const dir = path.join(tmpHome, '.awm');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify(prefs, null, 2) + '\n');
    }

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-run-'));
        tmpWork = tmpHome;
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

    it('--json emits a parseable provider report and keeps the same exit code', () => {
        const code = runDoctor({ cwd: tmpHome, json: true });
        const parsed = JSON.parse(stdout());
        expect(parsed.overall).toBe('degraded');
        expect(Array.isArray(parsed.providers)).toBe(true);
        expect(code).toBe(1);
    });

    it('reports every enabled provider and stable remediation codes in JSON', () => {
        writePrefs(prefsWith(['claude-code', 'opencode', 'codex']));
        const code = runDoctor({ cwd: tmpWork, json: true });
        const report = JSON.parse(stdout());
        expect(report.providers.map((provider: { id: string }) => provider.id))
            .toEqual(['claude-code', 'opencode', 'codex']); // verifies R12
        expect(report.providers.find((provider: { id: string }) => provider.id === 'codex'))
            .toMatchObject({
                checks: expect.arrayContaining([
                    expect.objectContaining({ id: 'binary.version' }),
                    expect.objectContaining({ id: 'skills.global' }),
                    expect.objectContaining({ id: 'agents.native' }),
                    expect.objectContaining({ id: 'hook.trust' }),
                ]),
            }); // verifies R2, R7, R8, R18
        expect(code).toBe(1);
    });

    it('reports a clear, specific error for an invalid --agent value, not a generic "internal error"', () => {
        const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const code = runDoctor({ cwd: tmpHome, agent: 'not-a-real-agent' });
            expect(code).toBe(2);
            const written = errSpy.mock.calls.map((c) => c[0]).join('');
            expect(written).toContain('awm doctor: Invalid agent "not-a-real-agent"');
            expect(written).not.toContain('internal error');
        } finally {
            errSpy.mockRestore();
        }
    });

    it('reports a clear error when --agent names a target that is not enabled', () => {
        const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            // Bare HOME → default preferences enable only claude-code.
            const code = runDoctor({ cwd: tmpHome, agent: 'codex' });
            expect(code).toBe(2);
            const written = errSpy.mock.calls.map((c) => c[0]).join('');
            expect(written).toContain('awm doctor: codex is not enabled');
            expect(written).not.toContain('internal error');
        } finally {
            errSpy.mockRestore();
        }
    });
});
