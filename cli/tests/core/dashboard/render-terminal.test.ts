import { renderFullTerminal } from '../../../src/core/dashboard/render-terminal';
import { dashboardSnapshot, type DashboardSnapshotV1 } from '../../../src/core/dashboard/types';
import { validateDashboardSnapshotV1 } from '../../../src/core/dashboard/validate';

function completeSnapshot(overrides: Partial<DashboardSnapshotV1> = {}): DashboardSnapshotV1 {
    return dashboardSnapshot({
        project: { detected: true, label: 'agentic-workflow' },
        confidence: 'provisional',
        overall: 'degraded',
        sections: [
            { id: 'machine', availability: 'available', items: [{ id: 'machine.cli', label: 'CLI installation', state: 'ok', detail: 'v8.1.6' }] },
            { id: 'project', availability: 'available', items: [{ id: 'project.sensors', label: 'Sensors', state: 'attention', detail: '2 stale', remediation: 'awm sync' }] },
            { id: 'planning', availability: 'available', items: [{ id: 'planning.plan', label: 'Active plan', state: 'ok', detail: 'executing' }] },
            { id: 'execution', availability: 'unavailable', items: [{ id: 'execution.source', label: 'Execution source', state: 'unavailable', remediation: 'awm doctor --full' }] },
            { id: 'qa', availability: 'available', items: [{ id: 'qa.gate', label: 'Verification gate', state: 'missing', remediation: 'awm sensors' }] },
            { id: 'retro', availability: 'available', items: [{ id: 'retro.cure', label: 'Cure observations', state: 'not_applicable' }] },
            { id: 'history', availability: 'available', items: [{ id: 'history.cycle', label: 'Eligible cycle', state: 'ok', detail: '5 minutes' }] },
        ],
        ...overrides,
    });
}

describe('renderFullTerminal', () => {
    it('renders all lifecycle sections in canonical order with status and remediation', () => {
        const output = renderFullTerminal(validateDashboardSnapshotV1(completeSnapshot()));
        const headings = ['Machine / install', 'Project readiness', 'Design / planning', 'Execution', 'QA', 'Retro', 'Final / history'];
        expect(headings.map((heading) => output.indexOf(heading))).toEqual([...headings.map((_, index) => expect.any(Number))].map((_, index) => expect.any(Number)));
        for (let index = 1; index < headings.length; index++) expect(output.indexOf(headings[index])).toBeGreaterThan(output.indexOf(headings[index - 1]));
        expect(output).toContain('⚠ Sensors [project.sensors] — 2 stale');
        expect(output).toContain('→ awm sync');
        expect(output).toContain('⊘ Execution source [execution.source] — unavailable');
        expect(output).toContain('✖ Verification gate [qa.gate] — missing');
    });

    it('renders machine-only, unavailable, provisional, and empty states honestly without ANSI color', () => {
        const output = renderFullTerminal(validateDashboardSnapshotV1(dashboardSnapshot({
            overall: 'degraded',
            confidence: 'provisional',
            sections: [{ id: 'machine', availability: 'unavailable', items: [] }],
        })));
        expect(output).toContain('Project: No project detected');
        expect(output).toContain('Confidence: provisional');
        expect(output).toContain('source unavailable');
        expect(output).toContain('No observations reported.');
        expect(output).not.toMatch(/\u001b\[/);
    });

    it('keeps every long-history and large-task observation visible deterministically', () => {
        const history = Array.from({ length: 500 }, (_, index) => ({ id: `history.${index}`, label: `Cycle ${index}`, state: 'ok' as const, detail: `${index} retries` }));
        const execution = Array.from({ length: 2000 }, (_, index) => ({ id: `execution.${index}`, label: `Task ${index}`, state: 'ok' as const }));
        const snapshot = validateDashboardSnapshotV1(completeSnapshot({ sections: [
            { id: 'machine', availability: 'available', items: [] },
            { id: 'project', availability: 'available', items: [] },
            { id: 'planning', availability: 'available', items: [] },
            { id: 'execution', availability: 'available', items: execution },
            { id: 'qa', availability: 'available', items: [] },
            { id: 'retro', availability: 'available', items: [] },
            { id: 'history', availability: 'available', items: history },
        ] }));
        const first = renderFullTerminal(snapshot);
        expect(renderFullTerminal(snapshot)).toBe(first);
        expect(first).toContain('Task 1999');
        expect(first).toContain('Cycle 499');
        expect(first).not.toMatch(/score|ranking/i);
    });
});
