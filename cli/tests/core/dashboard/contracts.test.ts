import { DashboardValidationError, validateDashboardSnapshotV1 } from '../../../src/core/dashboard/validate';
import { dashboardSnapshot, type DashboardSnapshotV1 } from '../../../src/core/dashboard/types';

function snapshot(): DashboardSnapshotV1 {
    return {
        schema: 1,
        generatedAt: '2026-08-22T00:00:00.000Z',
        overall: 'healthy',
        project: { detected: true, label: 'Demo project' },
        confidence: 'none',
        sections: [
            { id: 'machine', availability: 'available', items: [{ id: 'cli', label: 'CLI', state: 'ok' }] },
            { id: 'project', availability: 'not_applicable', items: [] },
            { id: 'planning', availability: 'not_applicable', items: [] },
            { id: 'execution', availability: 'not_applicable', items: [] },
            { id: 'qa', availability: 'not_applicable', items: [] },
            { id: 'retro', availability: 'not_applicable', items: [] },
            { id: 'history', availability: 'not_applicable', items: [] },
        ],
    };
}

describe('validateDashboardSnapshotV1', () => {
    it('creates the safe deterministic dashboard snapshot default', () => {
        expect(dashboardSnapshot()).toEqual({
            schema: 1,
            generatedAt: '2026-08-22T00:00:00.000Z',
            overall: 'healthy',
            project: { detected: false, label: 'No project detected' },
            confidence: 'none',
            sections: [{ id: 'machine', availability: 'available', items: [] }],
        });
    });

    it('allows callers to override snapshot defaults', () => {
        expect(dashboardSnapshot({ overall: 'degraded' }).overall).toBe('degraded');
    });

    it('builds a complete canonical section set when callers select a project', () => {
        const value = dashboardSnapshot({ project: { detected: true, label: 'Demo project' }, confidence: 'provisional' });
        expect(validateDashboardSnapshotV1(value).sections.map((section) => section.id)).toEqual(['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history']);
    });

    it('returns a valid V1 snapshot', () => {
        expect(validateDashboardSnapshotV1(snapshot())).toEqual(snapshot());
    });

    it.each(['attention', 'missing', 'unavailable'] as const)('rejects actionable %s without remediation', (state) => {
        const value = snapshot();
        value.sections[0].items[0].state = state;
        expect(() => validateDashboardSnapshotV1(value)).toThrow(DashboardValidationError);
    });

    it('rejects project before machine', () => {
        const value = snapshot();
        value.sections.reverse();
        expect(() => validateDashboardSnapshotV1(value)).toThrow(/section order/i);
    });

    it('rejects an invalid schema version', () => {
        const value = snapshot() as unknown as { schema: number };
        value.schema = 2;
        expect(() => validateDashboardSnapshotV1(value)).toThrow(DashboardValidationError);
    });

    it('rejects invalid public enums', () => {
        const value = snapshot() as unknown as { overall: string };
        value.overall = 'unknown';
        expect(() => validateDashboardSnapshotV1(value)).toThrow(DashboardValidationError);
    });

    it('rejects duplicate item ids', () => {
        const value = snapshot();
        value.sections[0].items.push({ id: 'cli', label: 'Duplicate', state: 'not_applicable' });
        expect(() => validateDashboardSnapshotV1(value)).toThrow(DashboardValidationError);
    });

    it('rejects remediation on not applicable items', () => {
        const value = snapshot();
        value.sections[0].items[0] = { id: 'cli', label: 'CLI', state: 'not_applicable', remediation: 'remove' };
        expect(() => validateDashboardSnapshotV1(value)).toThrow(DashboardValidationError);
    });

    it('rejects lifecycle sections when no project is detected', () => {
        const value = dashboardSnapshot({
            project: { detected: false, label: 'No project detected' },
            sections: [
                { id: 'machine', availability: 'available', items: [] },
                { id: 'planning', availability: 'not_applicable', items: [] },
            ],
        });
        expect(() => validateDashboardSnapshotV1(value)).toThrow(/no project.*machine/i);
    });

    it('rejects a detected project without the complete canonical lifecycle sections', () => {
        const value = dashboardSnapshot({
            project: { detected: true, label: 'Demo project' },
            confidence: 'provisional',
            sections: [{ id: 'machine', availability: 'available', items: [] }],
        });
        expect(() => validateDashboardSnapshotV1(value)).toThrow(/detected project.*canonical lifecycle/i);
    });
});
