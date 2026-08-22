import { renderProviderReport, renderReport, runDoctor } from '../../src/commands/doctor';
import type { CheckReport, ProviderDiagnosticReport } from '../../src/core/diagnostics/types';
import type { AwmPreferences } from '../../src/utils/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { captureDoctorJsonFixture } from '../helpers/dashboard-fixtures';
import { dashboardSnapshot } from '../../src/core/dashboard/types';

describe('runDoctor legacy JSON fixtures', () => {
    it.each(['bare-home', 'project'] as const)('keeps %s JSON byte-for-byte compatible', (kind) => {
        const captured = captureDoctorJsonFixture(kind);
        try {
            const expected = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'doctor-json', `${kind}.json`), 'utf-8');
            expect(captured.output).toBe(expected);
            expect(captured.code).toBe(1);

            const parsed: unknown = JSON.parse(captured.output);
            expect(parsed).toEqual(expect.objectContaining({
                overall: 'degraded',
                providers: expect.any(Array),
            }));
            const provider = (parsed as { providers: Array<{ id: string; label: string; tier: string; checks: unknown[] }> }).providers[0];
            expect(provider).toEqual(expect.objectContaining({
                id: 'copilot',
                label: 'Copilot',
                tier: 'agents-md-managed',
                checks: expect.any(Array),
            }));
            expect(provider.checks).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'context.global', state: kind === 'project' ? 'stale' : 'absent' }),
            ]));
        } finally {
            captured.cleanup();
        }
    });
});

describe('runDoctor dashboard modes', () => {
    it.each([
        [{ json: true, full: true }, '--json cannot be combined with --full'],
        [{ json: true, html: 'report.html' }, '--json cannot be combined with --html'],
        [{ full: true, html: 'report.html' }, '--full cannot be combined with --html'],
        [{ force: true }, '--force requires --html'],
    ] as const)('rejects incompatible options before collection', (options, message) => {
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            expect(runDoctor(options)).toBe(2);
            expect(stderr.mock.calls.map((call) => String(call[0])).join('')).toContain(message);
        } finally { stderr.mockRestore(); }
    });

    it('maps healthy full, invalid, and failing HTML modes to 0, 2, and 2', () => {
        const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            expect(runDoctor({ full: true, cwd: '/definitely-not-a-project' })).toBe(0);
            expect(runDoctor({ html: '' })).toBe(2);
            expect(runDoctor({ html: '/definitely-missing-parent/report.html' })).toBe(2);
        } finally { stdout.mockRestore(); stderr.mockRestore(); }
    });

    it.each([{ full: true }, { html: 'report.html', force: true }] as const)('returns 1 for a degraded dashboard mode', (options) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-degraded-'));
        const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            expect(runDoctor({ ...options, cwd: root, collectSnapshot: () => dashboardSnapshot({ overall: 'degraded' }) })).toBe(1);
        } finally { stdout.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
    });
});

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

describe('renderProviderReport — capability tier (Task 4.4)', () => {
    it('shows the tier next to each provider label', () => {
        const report: ProviderDiagnosticReport = {
            overall: 'healthy',
            providers: [
                { id: 'claude-code', label: 'Claude Code', tier: 'hooks-native', checks: [] },
                { id: 'cursor', label: 'Cursor', tier: 'agents-md-managed', checks: [] },
                { id: 'antigravity', label: 'Antigravity', tier: 'context-only', checks: [] },
            ],
        };
        const out = renderProviderReport(report);
        expect(out).toContain('Provider: Claude Code (hooks-native)');
        expect(out).toContain('Provider: Cursor (agents-md-managed)');
        expect(out).toContain('Provider: Antigravity (context-only)');
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

    // Finding #1 (R7 QA): the real `awm doctor` command (this `runDoctor`,
    // text mode — not `renderReport`, which only `init.ts` calls) must
    // actually surface the Windows caveat on native Windows.
    it('surfaces the Windows caveat in real text output on native Windows only', () => {
        const realPlatform = process.platform;
        try {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            writeSpy.mockClear();
            runDoctor({ cwd: tmpHome });
            expect(stdout()).toMatch(/awm watch/i);

            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
            writeSpy.mockClear();
            runDoctor({ cwd: tmpHome });
            expect(stdout()).not.toMatch(/awm watch/i);
        } finally {
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        }
    });

    it('--json emits a parseable provider report and keeps the same exit code', () => {
        const code = runDoctor({ cwd: tmpHome, json: true });
        const parsed = JSON.parse(stdout());
        expect(parsed.overall).toBe('degraded');
        expect(Array.isArray(parsed.providers)).toBe(true);
        expect(code).toBe(1);
    });

    it('reports every enabled provider and stable remediation codes in JSON', () => {
        // El check `agents.native` solo se emite si hay artefactos nativos que
        // verificar: un registry sin `agents/` ya no produce una fila roja sin
        // remedio. Se siembra uno para que el check sea genuino en vez de
        // asertar sobre una fila que hoy, con razon, no existiria.
        fs.mkdirSync(path.join(tmpHome, '.codex', 'agents'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.codex', 'agents', 'demo.toml'), 'name = "demo"\n');
        writePrefs(prefsWith(['claude-code', 'opencode', 'codex']));
        const code = runDoctor({ cwd: tmpWork, json: true });
        const report = JSON.parse(stdout());
        expect(report.providers.map((provider: { id: string }) => provider.id))
            .toEqual(['claude-code', 'opencode', 'codex']); // verifies R12
        expect(report.providers.find((provider: { id: string }) => provider.id === 'codex'))
            .toMatchObject({
                tier: 'hooks-native', // Task 4.4
                checks: expect.arrayContaining([
                    expect.objectContaining({ id: 'binary.version' }),
                    expect.objectContaining({ id: 'skills.global' }),
                    expect.objectContaining({ id: 'agents.native' }),
                    expect.objectContaining({ id: 'hook.trust' }),
                ]),
            }); // verifies R2, R7, R8, R18
        expect(code).toBe(1);
    });

    it('includes tier for every provider in JSON output (Task 4.4)', () => {
        writePrefs(prefsWith(['claude-code', 'opencode', 'codex']));
        const code = runDoctor({ cwd: tmpWork, json: true });
        const report = JSON.parse(stdout());
        expect(report.providers.map((provider: { id: string; tier: string }) => provider.tier))
            .toEqual(['hooks-native', 'config-managed', 'hooks-native']);
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
