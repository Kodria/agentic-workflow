import { DASHBOARD_STYLES } from './styles';
import type { DashboardItemState, DashboardSectionV1, DashboardSnapshotV1 } from './types';
import { validateDashboardSnapshotV1 } from './validate';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const SECTION_TITLES: Record<DashboardSectionV1['id'], string> = { machine: 'Machine / install', project: 'Project readiness', planning: 'Design / planning', execution: 'Execution', qa: 'QA', retro: 'Retro', history: 'Final / history' };
const STATE_TEXT: Record<DashboardItemState, string> = { ok: 'OK', attention: 'Attention', missing: 'Missing', unavailable: 'Unavailable', not_applicable: 'Not applicable' };
const STATE_GLYPH: Record<DashboardItemState, string> = { ok: '●', attention: '▲', missing: '×', unavailable: '⊘', not_applicable: '—' };

function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function sectionHtml(section: DashboardSectionV1): string {
    const title = SECTION_TITLES[section.id];
    const availability = section.availability === 'available' ? '' : `<p class="availability ${section.availability}">⊘ Source ${escapeHtml(section.availability.replace('_', ' '))}</p>`;
    const rows = section.items.length === 0 ? '<p class="empty">No observations reported.</p>' : `<table><thead><tr><th scope="col">Observation</th><th scope="col">State</th><th scope="col">Detail</th><th scope="col">Remediation</th></tr></thead><tbody>${section.items.map((item) => `<tr><td data-label="Observation">${escapeHtml(item.label)}</td><td data-label="State"><span class="state ${item.state}" aria-label="${item.state}">${STATE_GLYPH[item.state]} ${STATE_TEXT[item.state]}</span></td><td data-label="Detail">${item.detail ? escapeHtml(item.detail) : '—'}</td><td data-label="Remediation">${item.remediation ? `<code>${escapeHtml(item.remediation)}</code>` : '—'}</td></tr>`).join('')}</tbody></table>`;
    return `<section id="${section.id}" aria-label="${title}"><header><h2>${title}</h2><span class="eyebrow">${escapeHtml(section.availability.replace('_', ' '))}</span></header><div class="section-body">${availability}${rows}</div></section>`;
}

/** Renders a portable, static, share-safe dashboard document. */
export function renderDashboardHtml(input: DashboardSnapshotV1): string {
    const snapshot = validateDashboardSnapshotV1(input);
    const overall = escapeHtml(snapshot.overall);
    const project = escapeHtml(snapshot.project.label);
    const sections = snapshot.sections.map(sectionHtml).join('');
    const links = snapshot.sections.map((section) => `<li><a href="#${section.id}">${SECTION_TITLES[section.id]}</a></li>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>AWM Doctor dashboard</title><style>${DASHBOARD_STYLES}</style></head><body><div class="shell"><nav aria-label="Dashboard sections"><p class="brand">AWM<small>Doctor dashboard</small></p><ul>${links}</ul></nav><main><header><p class="eyebrow">Read-only diagnostic evidence</p><h1>Project lifecycle</h1><p class="lede">Readiness, lifecycle state, and eligible observations presented directly for operator review.</p><p><span class="status ${overall}">● ${overall}</span> <span class="status">Confidence: ${escapeHtml(snapshot.confidence)}</span></p><p class="eyebrow">Project: ${project}</p></header>${sections}<footer>Generated ${escapeHtml(snapshot.generatedAt)} · Static share-safe dashboard</footer></main></div></body></html>\n`;
}
