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
            sections: [
                { id: 'machine', availability: 'available', items: [{ id: 'hostile', label: '<script>alert(1)</script>', state: 'attention', detail: '"quoted"', remediation: 'awm sync && echo <unsafe>' }] },
                { id: 'project', availability: 'not_applicable', items: [] }, { id: 'planning', availability: 'not_applicable', items: [] },
                { id: 'execution', availability: 'not_applicable', items: [] }, { id: 'qa', availability: 'not_applicable', items: [] },
                { id: 'retro', availability: 'not_applicable', items: [] }, { id: 'history', availability: 'not_applicable', items: [] },
            ],
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
        expect(html).toContain('data-operational-sidebar aria-label="Dashboard sections"');
        expect(html).toMatch(/<main[\s>]/);
        expect(html).toMatch(/<footer[\s>]/);
        for (const heading of ['Machine / install', 'Project readiness', 'Design / planning', 'Execution', 'QA', 'Retro', 'Final / history']) expect(html).toContain(`<h2>${heading}</h2>`);
        expect(html).toContain('<table>');
        expect(html).toContain('<th scope="col">State</th>');
        expect(html).not.toMatch(/<span class="state [^"]+" aria-label=/);
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
        expect(html).toContain('data-machine-bento');
        expect(html.match(/class="bento-card"/g)).toHaveLength(3);
        expect(html).toContain('Privacy &amp; security');
        expect(html).toContain('data-static-privacy-toggle');
        expect(html).toContain('type="checkbox" checked disabled');
        expect(html).toContain('Siguiente acción requerida');
        expect(html).toContain('Copy command (static)');
        expect(html).toContain('data-machine-bento');
        expect(html).toContain('data-next-actions');
        expect(html.match(/data-next-action=/g)).toHaveLength(3);
        expect(html).toContain('Inicializar proyecto');
        expect(html).toContain('<code>awm init</code>');
        expect(html.indexOf('awm sensors run')).toBeLessThan(html.indexOf('awm init'));
    });

    it('uses neutral machine configuration semantics when no project is detected', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({
            project: { detected: false, label: 'No project detected' },
            sections: [{ id: 'machine', availability: 'available', items: [] }],
        })));
        expect(html).toContain('<h1>Machine configuration</h1>');
        expect(html).toContain('Machine readiness and safe configuration state outside a project.');
        expect(html).toContain('aria-label="Machine configuration sections"');
        expect(html).not.toContain('Project lifecycle');
        expect(html).not.toContain('Dashboard sections');
    });

    it('matches the project lifecycle composition with machine preparation, timeline, provisional evidence, plans, and history', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({ confidence: 'provisional' })));
        expect(html).toContain('class="machine-preparation-strip" data-machine-preparation');
        expect(html).toContain('data-machine-preparation role="group" aria-labelledby="machine-preparation-heading"');
        expect(html).toContain('class="lifecycle-timeline" data-lifecycle-timeline');
        expect(html).toContain('data-lifecycle-timeline aria-labelledby="lifecycle-timeline-heading"');
        expect(html).toContain('class="timeline connected-timeline"');
        expect(html).toContain('<span aria-hidden="true" class="timeline-marker"></span>');
        for (const stage of ['Planning', 'Execution', 'QA', 'Retro', 'Evidence']) expect(html).toContain(`data-stage="${stage.toLowerCase()}"`);
        expect(html).toContain('Provisional evidence');
        expect(html).toContain('data-project-evidence role="group" aria-labelledby="project-evidence-heading"');
        expect(html).toContain('Planes de trabajo');
        expect(html).toContain('Impacto y trazabilidad');
        expect(html).toContain('data-project-header-actions role="group" aria-label="Project actions"');
        expect(html).toContain('data-project-breadcrumb');
        expect(html).toContain('data-project-nav');
        expect(html).toContain('data-machine-preparation-card="installation"');
        expect(html).toContain('data-machine-preparation-card="sensors"');
        expect(html).toContain('data-machine-preparation-card="persistence"');
        expect(html).toContain('data-plan-card="active"');
        expect(html).toContain('data-plan-card="blocked"');
        expect(html).toContain('Progreso: sin observación');
        expect(html).toContain('Ver plan (estático)');
        expect(html).toContain('<th scope="col">Tipo</th>');
        expect(html).toContain('<th scope="col">Fuente</th>');
        expect(html).toContain('<th scope="col">Estado</th>');
        expect(html).toContain('<th scope="col">Fecha</th>');
        expect(html).toContain('No hay evidencia de impacto disponible en este snapshot.');
        expect(html).toContain('data-closure-actions role="group" aria-labelledby="closure-actions-heading"');
    });

    it('uses the compact approved desktop composition rather than stretched generic cards', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({ confidence: 'provisional' })));
        expect(html).toContain('<div class="dashboard-content">');
        expect(html).toContain('width:min(100%,72rem)');
        expect(html).toContain('.machine-preparation-strip {');
        expect(html).toContain('.connected-timeline { border-top:1px solid var(--border);');
        expect(html).toContain('.timeline-marker {');
        expect(html).not.toContain('.timeline li::before');
        expect(html).not.toContain('.connected-timeline::before');
        expect(html).toContain('.timeline .state.unavailable { background:#38141c; color:#fff0ed;');
        expect(html).toContain('.evidence-grid.compact-composition');
        expect(html).toContain('font:14px/1.35');
    });

    it('includes the artifact-aligned, noninteractive machine toolbar without weakening static CSP', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({
            project: { detected: false, label: 'No project detected' },
            sections: [{ id: 'machine', availability: 'available', items: [] }],
        })));
        expect(html).toContain('data-dashboard-toolbar');
        expect(html).toContain('data-operational-sidebar');
        for (const label of ['Inicio', 'Estado', 'Configuración', 'Terminal']) expect(html).toContain(`>${label}<`);
        expect(html).toContain('data-sidebar-diagnose');
        expect(html).toContain('data-sidebar-operator-controls');
        expect(html).toContain('aria-label="Search dashboard"');
        expect(html).toContain('placeholder="Search resources" disabled');
        for (const label of ['Notifications (static)', 'Help (static)', 'Export dashboard (static)', 'New deployment (static)']) {
            expect(html).toContain(label);
        }
        expect(html).toContain("script-src 'none'");
    });

    it('renders every canonical project section once and in lifecycle order', () => {
        const html = renderDashboardHtml(validateDashboardSnapshotV1(snapshot({ confidence: 'provisional' })));
        const ids = ['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history'];
        const positions = ids.map((id) => html.indexOf(`<section id="${id}"`));
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect([...positions].sort((left, right) => left - right)).toEqual(positions);
        for (const id of ids) expect(html.match(new RegExp(`<section id="${id}"`, 'g'))).toHaveLength(1);
        expect(html.match(/<section[\s>]/g)).toHaveLength(ids.length);
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
