import { DASHBOARD_STYLES } from './styles';
import type { DashboardItemState, DashboardSectionV1, DashboardSnapshotV1 } from './types';
import { validateDashboardSnapshotV1 } from './validate';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const SECTION_TITLES: Record<DashboardSectionV1['id'], string> = { machine: 'Machine / install', project: 'Project readiness', planning: 'Design / planning', execution: 'Execution', qa: 'QA', retro: 'Retro', history: 'Final / history' };
const STATE_TEXT: Record<DashboardItemState, string> = { ok: 'OK', attention: 'Attention', missing: 'Missing', unavailable: 'Unavailable', not_applicable: 'Not applicable' };
const STATE_GLYPH: Record<DashboardItemState, string> = { ok: '●', attention: '▲', missing: '×', unavailable: '⊘', not_applicable: '—' };

function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function sectionHtml(section: DashboardSectionV1, supplement = ''): string {
    const title = SECTION_TITLES[section.id];
    const availability = section.availability === 'available' ? '' : `<p class="availability ${section.availability}">⊘ Source ${escapeHtml(section.availability.replace('_', ' '))}</p>`;
    const rows = section.items.length === 0 ? '<p class="empty">No observations reported.</p>' : `<table><thead><tr><th scope="col">Observation</th><th scope="col">State</th><th scope="col">Detail</th><th scope="col">Remediation</th></tr></thead><tbody>${section.items.map((item) => `<tr><td data-label="Observation">${escapeHtml(item.label)}</td><td data-label="State"><span class="state ${item.state}" aria-label="${item.state}">${STATE_GLYPH[item.state]} ${STATE_TEXT[item.state]}</span></td><td data-label="Detail">${item.detail ? escapeHtml(item.detail) : '—'}</td><td data-label="Remediation">${item.remediation ? `<code>${escapeHtml(item.remediation)}</code>` : '—'}</td></tr>`).join('')}</tbody></table>`;
    return `<section id="${section.id}" aria-label="${title}"><header><h2>${title}</h2><span class="eyebrow">${escapeHtml(section.availability.replace('_', ' '))}</span></header><div class="section-body">${availability}${supplement}${rows}</div></section>`;
}

function diagnosticCards(items: DashboardSectionV1['items'], attribute: 'data-machine-diagnostics' | 'data-machine-preparation'): string {
    const labels = ['installation', 'sensors', 'permissions'];
    const cards = items.slice(0, 3).map((item, index) => `<li data-diagnostic-card="${labels[index] ?? 'diagnostic'}"><span class="state ${item.state}" aria-label="${item.state}">${STATE_GLYPH[item.state]} ${STATE_TEXT[item.state]}</span><strong>${escapeHtml(item.label)}</strong><span>${item.detail ? escapeHtml(item.detail) : 'No additional detail'}</span></li>`).join('') || '<li><span class="state not_applicable" aria-label="not applicable">— Not applicable</span><strong>No machine observations</strong><span>Machine diagnostics are not available.</span></li>';
    return `<div ${attribute} aria-label="Machine preparation"><h3>${attribute === 'data-machine-diagnostics' ? 'Machine diagnostics' : 'Machine preparation'}</h3><ul class="diagnostic-grid">${cards}</ul></div>`;
}

function privacyAndActions(snapshot: DashboardSnapshotV1): string {
    const actions = snapshot.sections.flatMap((section) => section.items.filter((item) => item.remediation).map((item) => `<li><span class="state ${item.state}" aria-label="${item.state}">${STATE_GLYPH[item.state]} ${STATE_TEXT[item.state]}</span><span>${escapeHtml(item.label)}</span><code>${escapeHtml(item.remediation!)}</code></li>`)).join('') || '<li class="empty">No remediation is required.</li>';
    return `<section data-privacy-security aria-label="Privacy and security"><header><h2>Privacy &amp; security</h2></header><div class="section-body"><p class="lede">This portable view contains sanitized states and exact operator remedies only. It excludes paths, identities, environment values, secret-like values, raw command output, ledger prose, and error stacks.</p></div></section><section data-prioritized-actions aria-label="Prioritized actions"><header><h2>Prioritized actions</h2></header><div class="section-body"><ol class="action-list">${actions}</ol></div></section>`;
}

function projectComposition(snapshot: DashboardSnapshotV1): string {
    const stageSections: DashboardSectionV1['id'][] = ['planning', 'execution', 'qa', 'retro', 'history'];
    const byId = new Map(snapshot.sections.map((section) => [section.id, section]));
    const stages = stageSections.map((id) => {
        const section = byId.get(id);
        const stage = id === 'history' ? 'evidence' : id;
        const available = section?.availability === 'available';
        return `<li data-stage="${stage}"><strong>${stage === 'evidence' ? 'Evidence' : SECTION_TITLES[id]}</strong><span class="state ${available ? 'ok' : 'unavailable'}">${available ? '● Available' : '⊘ Unavailable'}</span></li>`;
    }).join('');
    const provisional = snapshot.confidence === 'provisional' ? '<aside data-provisional-evidence aria-label="Provisional evidence"><strong>Provisional evidence</strong><span>Current observations are still being verified by downstream QA and evidence capture.</span></aside>' : '';
    const machineSupplement = `${diagnosticCards(byId.get('machine')?.items ?? [], 'data-machine-preparation')}<div data-lifecycle-timeline aria-label="Lifecycle timeline"><h3>Lifecycle timeline</h3><ol class="timeline">${stages}</ol></div>${provisional}`;
    const historySupplement = '<div data-project-evidence aria-label="Project evidence composition"><div class="evidence-grid"><div><h3>Plans &amp; work</h3><p class="empty">Planning and execution observations remain visible above.</p></div><div><h3>Impact &amp; traceability</h3><p class="empty">QA, retro, and eligible history are visible here.</p></div></div></div>';
    return snapshot.sections.map((section) => sectionHtml(section, section.id === 'machine' ? machineSupplement : section.id === 'history' ? historySupplement : '')).join('');
}

/** Renders a portable, static, share-safe dashboard document. */
export function renderDashboardHtml(input: DashboardSnapshotV1): string {
    const snapshot = validateDashboardSnapshotV1(input);
    const overall = escapeHtml(snapshot.overall);
    const project = escapeHtml(snapshot.project.label);
    const sections = snapshot.project.detected ? projectComposition(snapshot) : `${diagnosticCards(snapshot.sections.find((section) => section.id === 'machine')?.items ?? [], 'data-machine-diagnostics')}${privacyAndActions(snapshot)}${snapshot.sections.map((section) => sectionHtml(section)).join('')}`;
    const links = snapshot.sections.map((section) => `<li><a href="#${section.id}">${SECTION_TITLES[section.id]}</a></li>`).join('');
    const projectDetected = snapshot.project.detected;
    const heading = projectDetected ? 'Project lifecycle' : 'Machine configuration';
    const intro = projectDetected ? 'Readiness, lifecycle state, and eligible observations presented directly for operator review.' : 'Machine readiness and safe configuration state outside a project.';
    const navLabel = projectDetected ? 'Dashboard sections' : 'Machine configuration sections';
    const context = projectDetected ? `Project: ${project}` : 'No project detected';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>AWM Doctor dashboard</title><style>${DASHBOARD_STYLES}</style></head><body><div class="shell"><nav aria-label="${navLabel}"><p class="brand">AWM<small>Doctor dashboard</small></p><ul>${links}</ul></nav><main><header><p class="eyebrow">Read-only diagnostic evidence</p><h1>${heading}</h1><p class="lede">${intro}</p><p><span class="status ${overall}">● ${overall}</span> <span class="status">Confidence: ${escapeHtml(snapshot.confidence)}</span></p><p class="eyebrow">${context}</p></header>${sections}<footer>Generated ${escapeHtml(snapshot.generatedAt)} · Static share-safe dashboard</footer></main></div></body></html>\n`;
}
