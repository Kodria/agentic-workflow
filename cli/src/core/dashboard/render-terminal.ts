import type { DashboardItemState, DashboardSectionV1, DashboardSnapshotV1 } from './types';
import { validateDashboardSnapshotV1 } from './validate';

const SECTION_TITLES: Record<DashboardSectionV1['id'], string> = {
    machine: 'Machine / install',
    project: 'Project readiness',
    planning: 'Design / planning',
    execution: 'Execution',
    qa: 'QA',
    docs: 'Docs',
    retro: 'Retro',
    history: 'Final / history',
    processes: 'Processes',
};

const STATE_PRESENTATION: Record<DashboardItemState, { glyph: string; text: string }> = {
    ok: { glyph: '✔', text: 'ok' },
    attention: { glyph: '⚠', text: 'attention' },
    missing: { glyph: '✖', text: 'missing' },
    unavailable: { glyph: '⊘', text: 'unavailable' },
    not_applicable: { glyph: '—', text: 'not applicable' },
};

/** Renders a complete, color-free dashboard suitable for terminals and logs. */
export function renderFullTerminal(input: DashboardSnapshotV1): string {
    const snapshot = validateDashboardSnapshotV1(input);
    const lines = [
        `AWM dashboard · ${snapshot.overall}`,
        `Project: ${snapshot.project.label}`,
        `Confidence: ${snapshot.confidence}`,
    ];
    for (const section of snapshot.sections) {
        lines.push('', SECTION_TITLES[section.id]);
        if (section.id === 'history') lines.push(`  Eligible evidence rows: ${section.items.length}`);
        if (section.availability !== 'available') lines.push(`  ⊘ source ${section.availability.replace('_', ' ')}`);
        if (section.items.length === 0) lines.push('  No observations reported.');
        for (const item of section.items) {
            const presentation = STATE_PRESENTATION[item.state];
            lines.push(`  ${presentation.glyph} ${item.label} [${item.id}]${item.detail ? ` — ${item.detail}` : ` — ${presentation.text}`}`);
            if (item.remediation) lines.push(`    → ${item.remediation}`);
        }
    }
    return lines.join('\n');
}
