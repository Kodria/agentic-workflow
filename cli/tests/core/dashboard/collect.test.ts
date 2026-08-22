import { collectDashboardSnapshot, REMEDIATION_BY_FINDING_ID } from '../../../src/core/dashboard/collect';
import { sanitizeDashboardSource } from '../../../src/core/dashboard/sanitize';
import { writeCycleEvidence } from '../../../src/core/evidence/store';
import { cycleEvidenceFixture } from '../../helpers/evidence-fixtures';
import fs from 'fs';
import os from 'os';
import path from 'path';

const fixedNow = '2026-08-22T00:00:00.000Z';

describe('collectDashboardSnapshot', () => {
    it('returns only a healthy machine section outside a project', () => {
        const project = jest.fn();
        const plans = jest.fn();
        const execution = jest.fn();
        const snapshot = collectDashboardSnapshot({
            cwd: '/definitely-not-a-project', now: fixedNow,
            adapters: { machine: () => ({ findings: [] }), project, plans, execution },
        });
        expect(snapshot.project).toEqual({ detected: false, label: 'No project detected' });
        expect(snapshot.sections.map((section) => section.id)).toEqual(['machine']);
        expect(snapshot.overall).toBe('healthy');
        expect(project).not.toHaveBeenCalled();
        expect(plans).not.toHaveBeenCalled();
        expect(execution).not.toHaveBeenCalled();
    });

    it('fails loudly for malformed central machine findings', () => {
        expect(() => collectDashboardSnapshot({ cwd: '/definitely-not-a-project', now: fixedNow, adapters: { machine: () => ({ findings: [{ id: '', label: 'Preferences', state: 'ok' }] }), project: jest.fn(), plans: jest.fn(), execution: jest.fn() } })).toThrow(/finding/i);
    });

    it.each([undefined, null, {}, 'healthy'])('rejects a non-array central machine findings value: %p', (findings) => {
        expect(() => collectDashboardSnapshot({
            cwd: '/definitely-not-a-project', now: fixedNow,
            adapters: { machine: () => ({ findings } as never), project: jest.fn(), plans: jest.fn(), execution: jest.fn() },
        })).toThrow('Dashboard findings must be an array');
    });

    it('uses exact verified remediation commands and stable ordered sections', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: {
                machine: () => ({ findings: [{ id: 'machine.preferences.missing', label: 'Preferences', state: 'missing' }] }),
                project: () => ({ label: 'Demo', findings: [{ id: 'project.profile.missing', label: 'Profile', state: 'missing' }] }),
                plans: () => Array.from({ length: 2000 }, (_, index) => ({ id: `plan.${index}`, label: `Plan ${index}`, state: 'ok' as const })),
                execution: () => ({}),
            },
        });
        expect(snapshot.sections.map((section) => section.id)).toEqual(['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history']);
        expect(snapshot.sections.find((section) => section.id === 'machine')?.items[0].remediation).toBe('awm init');
        expect(snapshot.sections.find((section) => section.id === 'planning')?.items).toHaveLength(2000);
        expect(snapshot.sections.find((section) => section.id === 'history')?.items).toHaveLength(0);
        expect(JSON.stringify(snapshot)).not.toMatch(/score|ranking/i);
    });

    it('isolates optional adapter failures and omits unverified remediation', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: {
                machine: () => ({ findings: [{ id: 'unknown', label: 'Unknown', state: 'missing' }] }),
                project: () => { throw new Error('corrupt project source'); },
                plans: () => [], execution: () => undefined,
            },
        });
        expect(snapshot.sections.find((section) => section.id === 'machine')?.items).toEqual([]);
        expect(snapshot.sections.find((section) => section.id === 'project')?.availability).toBe('unavailable');
        expect(snapshot.sections.find((section) => section.id === 'project')?.items).toEqual([]);
    });

    it('marks execution-derived sections unavailable when no read-only execution source exists', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined },
        });
        for (const id of ['execution', 'qa', 'retro']) {
            expect(snapshot.sections.find((section) => section.id === id)?.availability).toBe('unavailable');
        }
    });

    it('isolates malformed optional source data to its owning section', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [{ id: 'bad', label: 'Profile', state: 'invented' as never }] }), plans: () => [], execution: () => undefined },
        });
        expect(snapshot.sections.find((section) => section.id === 'project')?.availability).toBe('unavailable');
        expect(snapshot.sections.find((section) => section.id === 'machine')?.availability).toBe('available');
    });

    it('isolates malformed post-sanitization plan findings', () => {
        const snapshot = collectDashboardSnapshot({ cwd: process.cwd(), now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [{ id: '', label: 'Profile', state: 'ok' }], execution: () => undefined } });
        expect(snapshot.sections.find((section) => section.id === 'planning')?.availability).toBe('unavailable');
    });

    it('isolates malformed project findings without dropping other sections', () => {
        const snapshot = collectDashboardSnapshot({ cwd: process.cwd(), now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [{ id: '', label: 'Profile', state: 'ok' }] }), plans: () => [], execution: () => undefined } });
        expect(snapshot.sections.find((section) => section.id === 'project')?.availability).toBe('unavailable');
        expect(snapshot.sections.find((section) => section.id === 'planning')?.availability).toBe('available');
    });

    it.each(['execution', 'qa', 'retro'] as const)('isolates malformed %s findings', (key) => {
        const snapshot = collectDashboardSnapshot({ cwd: process.cwd(), now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => ({ [key]: [{ id: '', label: 'Profile', state: 'ok' }] }) } });
        expect(snapshot.sections.find((section) => section.id === key)?.availability).toBe('unavailable');
    });

    it('renders exact remediation only for a canonical optional source failure', () => {
        const knownFailure = Object.assign(new Error('sensors unavailable'), { findingId: 'project.sensors.unavailable', remediationVerified: true });
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: { machine: () => ({ findings: [] }), project: () => { throw knownFailure; }, plans: () => [], execution: () => undefined },
        });
        expect(snapshot.sections.find((section) => section.id === 'project')?.items).toEqual([
            expect.objectContaining({ id: 'project.sensors.unavailable', state: 'unavailable', remediation: 'awm sensors status' }),
        ]);
    });

    it.each([
        ['plans', 'planning.source.unavailable', 'planning', 'awm preflight'],
        ['execution', 'execution.source.unavailable', 'execution', 'awm sensors status'],
    ] as const)('renders a known %s failure in its owner section', (adapter, findingId, sectionId, remediation) => {
        const failure = Object.assign(new Error('unavailable'), { findingId, remediationVerified: true });
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: {
                machine: () => ({ findings: [] }), project: () => ({ findings: [] }),
                plans: () => { if (adapter === 'plans') throw failure; return []; },
                execution: () => { if (adapter === 'execution') throw failure; return undefined; },
            },
        });
        expect(snapshot.sections.find((section) => section.id === sectionId)?.items[0]).toEqual(expect.objectContaining({ id: findingId, remediation }));
    });

    it('sorts findings by stable canonical id', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: '/definitely-not-a-project', now: fixedNow,
            adapters: { machine: () => ({ findings: [
                { id: 'machine.registries.stale', label: 'Registries', state: 'attention' },
                { id: 'machine.preferences.missing', label: 'Preferences', state: 'missing' },
            ] }), project: jest.fn(), plans: jest.fn(), execution: jest.fn() },
        });
        expect(snapshot.sections[0].items.map((item) => item.id)).toEqual(['machine.preferences.missing', 'machine.registries.stale']);
    });

    it.each(['blocked', 'active', 'executed', 'retro_pending', 'qa_pending', 'legacy_unverifiable'] as const)('integrates lifecycle state %s into plan detail', (expected) => {
        const lifecycle = expected === 'blocked' ? { journal: { state: 'blocked' as const }, markers: { qaComplete: false, retroComplete: false }, tasks: { total: 1, completed: 0 } }
            : expected === 'active' ? { journal: { state: 'active' as const }, markers: { qaComplete: false, retroComplete: false }, tasks: { total: 1, completed: 0 } }
                : expected === 'executed' ? { markers: { qaComplete: true, retroComplete: true }, tasks: { total: 1, completed: 1 } }
                    : expected === 'retro_pending' ? { markers: { qaComplete: true, retroComplete: false }, tasks: { total: 1, completed: 1 } }
                        : expected === 'qa_pending' ? { markers: { qaComplete: false, retroComplete: false }, tasks: { total: 1, completed: 1 } }
                            : { markers: { qaComplete: false, retroComplete: false }, tasks: { total: 0, completed: 0 } };
        const snapshot = collectDashboardSnapshot({ cwd: process.cwd(), now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [{ id: 'plan.lifecycle', label: 'Profile', state: 'ok', lifecycle }], execution: () => undefined } });
        expect(snapshot.sections.find((section) => section.id === 'planning')?.items[0].detail).toBe(expected);
    });

    it('degrades a machine-only dashboard for actionable machine findings', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: '/definitely-not-a-project', now: fixedNow,
            adapters: { machine: () => ({ findings: [{ id: 'machine.preferences.missing', label: 'Preferences', state: 'missing' }] }), project: jest.fn(), plans: jest.fn(), execution: jest.fn() },
        });
        expect(snapshot.sections.map((section) => section.id)).toEqual(['machine']);
        expect(snapshot.overall).toBe('degraded');
    });

    it('loads validated local evidence only after a project is detected and renders every cycle fact', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-dashboard-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        writeCycleEvidence(root, cycleEvidenceFixture());
        const snapshot = collectDashboardSnapshot({ cwd: root, now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined } });
        const history = snapshot.sections.find((section) => section.id === 'history');
        expect(snapshot.confidence).toBe('provisional');
        expect(history?.availability).toBe('available');
        expect(history?.items[0]?.detail).toContain('retries 1; QA 1/1; first-pass yes; cures awaiting_observation');
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('renders a blocked evidence cycle as an actionable history item with a verified remedy', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-dashboard-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        writeCycleEvidence(root, { ...cycleEvidenceFixture(), cycleState: 'blocked', plan: { ref: 'docs/plans/current.md', state: 'blocked' } });

        const snapshot = collectDashboardSnapshot({ cwd: root, now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined } });

        expect(snapshot.sections.find((section) => section.id === 'history')?.items).toEqual([
            expect.objectContaining({ state: 'attention', remediation: 'awm preflight' }),
        ]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it.each(['.awm', 'evidence', 'cycles'] as const)('does not follow a symlinked %s evidence ancestor', (ancestor) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-dashboard-'));
        const external = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-external-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        const externalCycles = ancestor === '.awm' ? path.join(external, 'evidence', 'cycles') : path.join(external, 'cycles');
        fs.mkdirSync(externalCycles, { recursive: true });
        fs.writeFileSync(path.join(externalCycles, `${'a'.repeat(64)}.json`), JSON.stringify(cycleEvidenceFixture()));
        if (ancestor === '.awm') fs.symlinkSync(external, path.join(root, '.awm'));
        else if (ancestor === 'evidence') {
            fs.mkdirSync(path.join(root, '.awm'));
            fs.symlinkSync(external, path.join(root, '.awm', 'evidence'));
        } else {
            fs.mkdirSync(path.join(root, '.awm', 'evidence'), { recursive: true });
            fs.symlinkSync(external, path.join(root, '.awm', 'evidence', 'cycles'));
        }
        const snapshot = collectDashboardSnapshot({ cwd: root, now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined } });
        const history = snapshot.sections.find((section) => section.id === 'history');
        expect(history).toEqual(expect.objectContaining({ availability: 'unavailable', items: [] }));
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
    });

    it('does not follow a symlinked evidence file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-dashboard-'));
        const external = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-external-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        const cycleId = 'a'.repeat(64);
        const externalFile = path.join(external, `${cycleId}.json`);
        fs.writeFileSync(externalFile, JSON.stringify(cycleEvidenceFixture()));
        const directory = path.join(root, '.awm', 'evidence', 'cycles');
        fs.mkdirSync(directory, { recursive: true });
        fs.symlinkSync(externalFile, path.join(directory, `${cycleId}.json`));
        const snapshot = collectDashboardSnapshot({ cwd: root, now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined } });
        expect(snapshot.sections.find((section) => section.id === 'history')).toEqual(expect.objectContaining({ availability: 'unavailable', items: [] }));
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
    });

    it.each(['duplicate', 'mismatch'] as const)('does not accept %s evidence filenames', (caseName) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-dashboard-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        writeCycleEvidence(root, cycleEvidenceFixture());
        const directory = path.join(root, '.awm', 'evidence', 'cycles');
        const record = cycleEvidenceFixture();
        const filename = caseName === 'duplicate' ? `${'b'.repeat(64)}.json` : `${'b'.repeat(64)}.json`;
        fs.writeFileSync(path.join(directory, filename), JSON.stringify(caseName === 'duplicate' ? record : { ...record, cycleId: 'c'.repeat(64) }));
        const snapshot = collectDashboardSnapshot({ cwd: root, now: fixedNow, adapters: { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined } });
        expect(snapshot.sections.find((section) => section.id === 'history')).toEqual(expect.objectContaining({ availability: 'unavailable', items: [] }));
        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe('sanitizeDashboardSource', () => {
    it('removes hostile paths and secrets before rendering', () => {
        const safe = sanitizeDashboardSource({ path: '/var/lib/private', token: 'ghp_secret', username: 'alice', output: '<script>alert(1)</script>', rawOutput: 'sk-live-secret', detail: 'log:(cwd=/tmp/run/output) unc=(\\\\server\\share\\secret)(MODE=production)', label: 'alice workstation' });
        expect(JSON.stringify(safe)).not.toMatch(/alice|ghp_|script|\/var\/|\/tmp\/|sk-live|alert|server|share|MODE=production/i);
    });

    it('replaces dynamic finding identifiers with opaque safe identifiers', () => {
        const safe = sanitizeDashboardSource({ findings: [
            { id: 'alice@example.com', label: 'Preferences', state: 'missing' },
            { id: '192.0.2.44/repository-private', label: 'Profile', state: 'missing' },
            { id: 'machine.preferences.missing', label: 'Preferences', state: 'missing' },
        ] });
        const serialized = JSON.stringify(safe);
        expect(serialized).not.toMatch(/alice@example|192\.0\.2\.44|repository-private/i);
        expect(serialized).toContain('machine.preferences.missing');
        expect(serialized).toMatch(/item-[a-f0-9]{16}/);
    });

    it('rejects invalid item states explicitly', () => {
        expect(() => sanitizeDashboardSource({ state: 'invented' })).toThrow(/state/i);
    });

    it('omits raw dynamic command and error details', () => {
        const safe = sanitizeDashboardSource({ findings: [{ id: 'machine.preferences.missing', label: 'Preferences', state: 'missing', detail: 'Error: ghp_secret at /tmp/private; TOKEN=value' }] });
        expect(JSON.stringify(safe)).not.toMatch(/Error|ghp_|\/tmp|TOKEN=/i);
        expect(JSON.stringify(safe)).not.toContain('detail');
    });
});

test('exports canonical remediation commands', () => {
    expect(REMEDIATION_BY_FINDING_ID['machine.preferences.missing']).toBe('awm init');
});
