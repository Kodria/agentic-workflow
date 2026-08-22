/** Inline visual system derived from the approved Stitch dashboard artifacts. */
export const DASHBOARD_STYLES = `
:root { color-scheme: dark; --canvas:#070d16; --surface:#101a29; --surface-raised:#172235; --surface-nav:#202a3b; --ink:#edf3ff; --muted:#b7c2d4; --border:#39455b; --indigo:#aebcff; --cyan:#8cecff; --amber:#ffc06a; --red:#ffb4ac; --green:#77e8be; --radius:4px; }
* { box-sizing:border-box; }
html { background:var(--canvas); color:var(--ink); font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
body { margin:0; background:var(--canvas); }
.shell { display:grid; grid-template-columns:13.5rem minmax(0,1fr); min-height:100vh; }
nav { background:var(--surface-nav); border-right:1px solid var(--border); padding:1.25rem .875rem; }
.brand { margin:0 0:1.5rem; font-size:1.1rem; font-weight:750; letter-spacing:-.03em; }
.brand small { display:block; color:var(--muted); font-size:.72rem; font-weight:500; letter-spacing:0; }
nav ul { list-style:none; margin:0; padding:0; display:grid; gap:.25rem; }
nav a { color:var(--muted); display:block; padding:.45rem .55rem; border-left:2px solid transparent; text-decoration:none; }
nav a:hover, nav a:focus-visible { background:var(--surface-raised); color:var(--ink); border-color:var(--indigo); }
main { width:min(100%,100rem); padding:0 clamp(1rem,4vw,4rem) 4rem; }
header { border-bottom:1px solid var(--border); padding-bottom:1.25rem; }
.dashboard-toolbar { align-items:center; display:flex; flex-wrap:wrap; gap:.65rem; justify-content:space-between; margin:0 calc(clamp(1rem,4vw,4rem) * -1); min-height:3.5rem; padding:.55rem clamp(1rem,4vw,4rem); }
.toolbar-brand { font-weight:750; letter-spacing:-.025em; margin:0; } .toolbar-brand span { color:var(--muted); font-size:.76rem; font-weight:500; margin-left:.35rem; }
.dashboard-toolbar form { margin-left:auto; } .dashboard-toolbar input { background:#080e18; border:1px solid var(--border); border-radius:var(--radius); color:var(--muted); min-width:12rem; padding:.4rem .55rem; } .dashboard-toolbar input:disabled { cursor:not-allowed; opacity:.72; }
.toolbar-actions,.project-header-actions,.closure-actions > div:last-child { display:flex; flex-wrap:wrap; gap:.4rem; }
button { background:var(--surface-raised); border:1px solid var(--border); border-radius:var(--radius); color:var(--ink); font:inherit; padding:.38rem .55rem; } button:disabled { cursor:not-allowed; opacity:.7; } button:focus-visible,input:focus-visible { outline:3px solid var(--cyan); outline-offset:3px; }
.page-header { padding:2.25rem 0 1.25rem; } .project-header-actions { margin-top:.9rem; }
h1,h2,p { margin-top:0; } h1 { font-size:clamp(1.7rem,3vw,2.35rem); letter-spacing:-.035em; margin-bottom:.25rem; } h2 { font-size:1rem; letter-spacing:.035em; margin:0; }
.eyebrow,.status { color:var(--muted); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.78rem; }
.status { display:inline-flex; align-items:center; gap:.4rem; border:1px solid var(--border); border-radius:var(--radius); padding:.2rem .5rem; }
.status.degraded { color:var(--amber); border-color:#72552e; } .status.healthy { color:var(--green); border-color:#2f6c58; }
.lede { color:var(--muted); max-width:72ch; }
section { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); margin-top:1rem; overflow:hidden; }
section > header { align-items:center; background:var(--surface-raised); border:0; display:flex; justify-content:space-between; padding:.8rem 1rem; }
.section-body { padding:1rem; }
.availability { color:var(--muted); font-size:.85rem; margin-bottom:.75rem; } .availability.unavailable { color:var(--amber); }
table { border-collapse:collapse; width:100%; } th,td { border-bottom:1px solid var(--border); padding:.65rem .5rem; text-align:left; vertical-align:top; } th { color:var(--muted); font-size:.72rem; letter-spacing:.07em; text-transform:uppercase; } tr:last-child td { border-bottom:0; }
.state { font-weight:650; white-space:nowrap; } .state.ok { color:var(--green); } .state.attention { color:var(--amber); } .state.missing,.state.unavailable { color:var(--red); } .state.not_applicable { color:var(--muted); }
code { background:#080e18; border:1px solid var(--border); border-radius:2px; color:var(--cyan); font:inherit; padding:.12rem .3rem; white-space:pre-wrap; overflow-wrap:anywhere; }
.empty { color:var(--muted); margin:0; } footer { color:var(--muted); font-size:.8rem; padding:1.25rem 0; }
.diagnostic-grid,.timeline,.action-list { display:grid; gap:.65rem; list-style:none; margin:0; padding:0; } .diagnostic-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .diagnostic-grid li,.timeline li { background:#0b1320; border:1px solid var(--border); display:grid; gap:.35rem; padding:.8rem; } .diagnostic-grid strong { font-size:.92rem; } .diagnostic-grid li > span:last-child { color:var(--muted); font: .78rem ui-monospace,SFMono-Regular,Consolas,monospace; }
.timeline { grid-template-columns:repeat(5,minmax(0,1fr)); } .timeline strong { font-size:.8rem; } .timeline .state { font-size:.74rem; } aside[data-provisional-evidence] { background:#261d10; border-left:3px solid var(--amber); color:var(--ink); display:grid; gap:.2rem; margin-top:1rem; padding:.85rem 1rem; } aside[data-provisional-evidence] span { color:var(--muted); }
.privacy-body { align-items:center; display:flex; gap:1rem; justify-content:space-between; } .static-note { color:var(--muted); font-size:.78rem; margin:0; } .static-toggle { align-items:center; background:#0b1320; border:1px solid var(--border); display:flex; flex-wrap:wrap; gap:.5rem; padding:.65rem; } .static-toggle input { accent-color:var(--cyan); } .static-toggle input:disabled { opacity:1; }
.evidence-grid { display:grid; gap:1rem; grid-template-columns:repeat(2,minmax(0,1fr)); padding:1rem; } .evidence-grid h2 { font-size:.9rem; margin-bottom:.4rem; } .plan-card { border:1px solid var(--border); display:grid; gap:.6rem; margin-top:.65rem; padding:.8rem; } .plan-card.active { border-left:3px solid var(--indigo); } .plan-card.blocked { border-left:3px solid var(--red); } .plan-card > div { align-items:center; display:flex; justify-content:space-between; gap:.5rem; } .plan-card p { color:var(--muted); font-size:.82rem; margin:0; }
.evidence-table { margin-top:.65rem; } .closure-actions { align-items:center; border-top:1px solid var(--border); display:flex; gap:1rem; justify-content:space-between; margin-top:1rem; padding:1rem; } .closure-actions h3 { font-size:.9rem; margin:0 0:.25rem; }
.action-list li { align-items:center; border-bottom:1px solid var(--border); display:grid; gap:.6rem; grid-template-columns:max-content minmax(8rem,1fr) minmax(10rem,auto) max-content; padding:.65rem 0; } .action-list li:last-child { border-bottom:0; }
.sr-only { clip:rect(0 0 0 0); clip-path:inset(50%); height:1px; overflow:hidden; position:absolute; white-space:nowrap; width:1px; }
a:focus-visible { outline:3px solid var(--cyan); outline-offset:3px; }
@media (max-width: 720px) { .shell { display:block; } nav { border-bottom:1px solid var(--border); border-right:0; } nav ul { grid-template-columns:repeat(2,minmax(0,1fr)); } main { padding:0 1rem 2rem; } .dashboard-toolbar { margin:0 -1rem; padding:.65rem 1rem; } .dashboard-toolbar form { margin-left:0; order:3; width:100%; } .dashboard-toolbar input { width:100%; } .privacy-body,.closure-actions { align-items:stretch; flex-direction:column; } .diagnostic-grid,.timeline,.evidence-grid { grid-template-columns:1fr; } .action-list li { grid-template-columns:max-content 1fr; } .action-list code,.action-list button { grid-column:1 / -1; } table,thead,tbody,tr,th,td { display:block; } thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); } td { border:0; padding:.25rem 0; } tr { border-bottom:1px solid var(--border); padding:.7rem 0; } tr:last-child { border-bottom:0; } td::before { color:var(--muted); content:attr(data-label) ": "; font-size:.72rem; text-transform:uppercase; } }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; scroll-behavior:auto !important; transition-duration:.01ms !important; } }
@media print { :root { color-scheme:light; } body { background:#fff; color:#000; } .shell { display:block; } nav { display:none; } main { max-width:none; padding:0; } section { break-inside:avoid; border-color:#666; } section > header { background:#eee; } .state,.availability,code { color:#000 !important; } }
`;
