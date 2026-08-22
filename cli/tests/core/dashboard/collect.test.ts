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
    });
});

describe('sanitizeDashboardSource', () => {
    it('removes hostile paths and secrets before rendering', () => {
        const safe = sanitizeDashboardSource({ path: '/home/alice/project', token: 'ghp_secret', output: '<script>alert(1)</script>' });
        expect(JSON.stringify(safe)).not.toMatch(/alice|ghp_|script|\/home\//i);
    });

    it('rejects invalid item states explicitly', () => {
        expect(() => sanitizeDashboardSource({ state: 'invented' })).toThrow(/state/i);
    });
});

test('exports canonical remediation commands', () => {
    expect(REMEDIATION_BY_FINDING_ID['machine.preferences.missing']).toBe('awm init');
});
