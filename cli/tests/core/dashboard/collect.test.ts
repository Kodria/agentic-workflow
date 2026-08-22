import { collectDashboardSnapshot, REMEDIATION_BY_FINDING_ID } from '../../../src/core/dashboard/collect';
import { sanitizeDashboardSource } from '../../../src/core/dashboard/sanitize';

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

    it('uses exact verified remediation commands and stable ordered sections', () => {
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: fixedNow,
            adapters: {
                machine: () => ({ findings: [{ id: 'machine.preferences.missing', label: 'Preferences', state: 'missing' }] }),
                project: () => ({ label: 'Demo', findings: [{ id: 'project.profile.missing', label: 'Profile', state: 'missing' }] }),
                plans: () => Array.from({ length: 2000 }, (_, index) => ({ id: `plan.${index}`, label: `Plan ${index}`, state: 'ok' as const })),
                execution: () => ({ history: Array.from({ length: 500 }, (_, index) => ({ id: `history.${index}`, label: `History ${index}`, state: 'ok' as const })) }),
            },
        });
        expect(snapshot.sections.map((section) => section.id)).toEqual(['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history']);
        expect(snapshot.sections.find((section) => section.id === 'machine')?.items[0].remediation).toBe('awm init');
        expect(snapshot.sections.find((section) => section.id === 'planning')?.items).toHaveLength(2000);
        expect(snapshot.sections.find((section) => section.id === 'history')?.items).toHaveLength(500);
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
});

describe('sanitizeDashboardSource', () => {
    it('removes hostile paths and secrets before rendering', () => {
        const safe = sanitizeDashboardSource({ path: '/var/lib/private', token: 'ghp_secret', username: 'alice', output: '<script>alert(1)</script>', rawOutput: 'sk-live-secret', detail: 'log:(cwd=/tmp/run/output) unc=(\\\\server\\share\\secret)(MODE=production)', label: 'alice workstation' });
        expect(JSON.stringify(safe)).not.toMatch(/alice|ghp_|script|\/var\/|\/tmp\/|sk-live|alert|server|share|MODE=production/i);
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
