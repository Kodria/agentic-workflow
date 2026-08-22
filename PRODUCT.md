# Product

## Register

product

## Users

AWM operators and maintainers use the Doctor dashboard while preparing a machine,
evaluating a project, or reviewing a development cycle. They need trustworthy,
share-safe evidence of readiness, remediation, and lifecycle progress without
having to inspect raw local state.

## Product Purpose

The dashboard presents the read-only health of the AWM harness from machine
installation through project readiness, planning, execution, QA, retro, and
eligible historical evidence. Success is an operator being able to identify an
actionable condition and its exact remediation, while unavailable and
provisional sources remain explicit rather than being implied as healthy.

## Brand Personality

Technical, composed, and evidence-led. The interface should make dense systems
information legible and calm, never promotional or gamified.

## Anti-references

Avoid scorecards, rankings, opaque health summaries, decorative dashboards,
raw private diagnostics, and any visual treatment that hides unavailable or
provisional evidence. Do not rely on color alone to communicate state.

## Design Principles

1. Show evidence and confidence, leaving judgment to the operator.
2. Preserve lifecycle order so readiness and downstream effects are legible.
3. Make remediation direct, exact, and adjacent to the actionable observation.
4. Treat unavailable, provisional, and empty states as honest first-class data.
5. Keep the artifact portable and share-safe by default.

## Accessibility & Inclusion

Meet WCAG AA contrast with visible focus states, semantic landmarks and
headings, text plus icons for every state, readable narrow and projected
desktop layouts, print styles, and reduced-motion support. The static artifact
must have no external scripts, fonts, images, connections, frames, forms, or
base URL; its CSP is restrictive and all dynamic values are escaped. It must
exclude paths, identities, environment values, secrets, raw command output,
ledger prose, and stacks.

## Approved Artifacts

- `.stitch/designs/machine-only-configuration-dashboard.html`
- `.stitch/designs/machine-only-configuration-dashboard.png`
- `.stitch/designs/project-lifecycle-impact-evidence.html`
- `.stitch/designs/project-lifecycle-impact-evidence.png`
