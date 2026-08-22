import { renderDashboardHtml } from '../../../src/core/dashboard/render-html';
import { dashboardSnapshot, type DashboardSnapshotV1 } from '../../../src/core/dashboard/types';
import { validateDashboardSnapshotV1 } from '../../../src/core/dashboard/validate';

function snapshot(overrides: Partial<DashboardSnapshotV1> = {}): DashboardSnapshotV1 {
    return dashboardSnapshot({
        project: { detected: true, label: 'doctor-dashboard' },
        confidence: 'observing',
        sections: [
            { id: 'machine', availability: 'available', items: [{ id: 'machine.cli', label: 'CLI', state: 'ok', detail: 'v8.1.6' }] },
            { id: 'project', availability: 'available', items: [{ id: 'project.context', label: 'Context', state: 'attention', remediation: 'awm sync' }] },
            { id: 'planning', availability: 'available', items: [] },
            { id: 'execution', availability: 'available', items: [] },
            { id: 'qa', availability: 'available', items: [] },
            { id: 'retro', availability: 'available', items: [] },
            { id: 'history', availability: 'available', items: [] },
        ],
        ...overrides,
    });
}

describe('renderDashboardHtml', () => {
    it('emits a self-contained scriptless document with the exact restrictive CSP and escaped dynamic values', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({
            project: { detected: true, label: '<img src=x onerror=alert(1)>' },
            sections: [{ id: 'machine', availability: 'available', items: [{ id: 'hostile', label: '<script>alert(1)</script>', state: 'attention', detail: '"quoted"', remediation: 'awm sync && echo <unsafe>' }] }],
        })));
        expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`);
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).toContain('awm sync &amp;&amp; echo &lt;unsafe&gt;');
        expect(html).not.toMatch(/<script|https?:\/\//i);
    });

    it('uses semantic landmarks and ordered sections with text state, focus, print, responsive, and reduced-motion support', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot()));
        expect(html).toMatch(/<header[\s>]/);
        expect(html).toContain('<nav aria-label="Dashboard sections">');
        expect(html).toMatch(/<main[\s>]/);
        expect(html).toMatch(/<footer[\s>]/);
        for (const heading of ['Machine / install', 'Project readiness', 'Design / planning', 'Execution', 'QA', 'Retro', 'Final / history']) expect(html).toContain(`<h2>${heading}</h2>`);
        expect(html).toContain('<table>');
        expect(html).toContain('<th scope="col">State</th>');
        expect(html).toContain('aria-label="attention"');
        expect(html).toContain(':focus-visible');
        expect(html).toContain('@media print');
        expect(html).toContain('@media (max-width: 720px)');
        expect(html).toContain('@media (prefers-reduced-motion: reduce)');
        expect(html).not.toMatch(/score|ranking/i);
    });

    it('matches the machine-only diagnostic composition with cards, privacy boundary, and prioritized remedies', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({
            project: { detected: false, label: 'No project detected' },
            sections: [{ id: 'machine', availability: 'available', items: [
                { id: 'machine.cli', label: 'Installation', state: 'ok', detail: 'v8.1.6' },
                { id: 'machine.sensors', label: 'Sensors', state: 'attention', remediation: 'awm sensors run' },
                { id: 'machine.permissions', label: 'Permissions', state: 'missing', remediation: 'awm init' },
            ] }],
        })));
        expect(html).toContain('data-machine-diagnostics');
        expect(html).toContain('data-diagnostic-card="installation"');
        expect(html).toContain('data-diagnostic-card="sensors"');
        expect(html).toContain('data-diagnostic-card="permissions"');
        expect(html).toContain('Privacy &amp; security');
        expect(html).toContain('Prioritized actions');
        expect(html.indexOf('awm sensors run')).toBeLessThan(html.indexOf('awm init'));
    });

    it('matches the project lifecycle composition with machine preparation, timeline, provisional evidence, plans, and history', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({ confidence: 'provisional' })));
        expect(html).toContain('data-machine-preparation');
        expect(html).toContain('data-lifecycle-timeline');
        for (const stage of ['Planning', 'Execution', 'QA', 'Retro', 'Evidence']) expect(html).toContain(`data-stage="${stage.toLowerCase()}"`);
        expect(html).toContain('Provisional evidence');
        expect(html).toContain('data-project-evidence');
        expect(html).toContain('Plans &amp; work');
        expect(html).toContain('Impact &amp; traceability');
    });

    it('is deterministic and preserves every history and task observation without privacy leakage', () => {
        const sections = ['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history'].map((id) => ({
            id: id as DashboardSnapshotV1['sections'][number]['id'], availability: 'available' as const,
            items: id === 'history' ? Array.from({ length: 500 }, (_, index) => ({ id: `history.${index}`, label: `Cycle ${index}`, state: 'ok' as const })) : id === 'execution' ? Array.from({ length: 2000 }, (_, index) => ({ id: `execution.${index}`, label: `Task ${index}`, state: 'ok' as const })) : [],
        }));
        const value = validateDashboardSnapshotV1(snapshot({ sections }));
        const first = renderDashboardHtml(value);
        expect(renderDashboardHtml(value)).toBe(first);
        expect(first).toContain('Cycle 499');
        expect(first).toContain('Task 1999');
    });
});
