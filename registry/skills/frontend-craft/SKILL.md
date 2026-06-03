---
name: frontend-craft
version: "1.0.0"
description: Use during development when implementing or adjusting any frontend/UI surface (landing pages, dashboards, components, forms, layouts, responsive behavior, styling, animation, polish). The single entry point for frontend craft — applies anti-slop, typography, color and responsive rules, and escalates to the impeccable engine for UI-centric work. NOT for backend, API, CLI, or non-UI tasks.
---

# Frontend Craft

The single orchestrator for frontend craft during development. It exists because LLM-built UI defaults to generic, templated output. This skill injects taste and rules, and decides how deep to go.

**Announce at start:** "I'm using the frontend-craft skill to apply frontend craft."

## Knowledge base

This skill draws on two bundled references. Read the relevant one before acting:
- `reference/design-taste-frontend.md` — Design Read (infer the brief), dials, anti-slop tells, layout/typography/color hard-rules. Read FIRST for any new surface.
- `reference/emil-design-eng.md` — animation decision framework, springs, easing, micro-interactions, component polish. Read when motion/interaction quality matters.

## When invoked

1. **Read the Design Direction.** If the design doc has a `## Design Direction` section (from brainstorming), treat it as the brief. If absent, infer it using `reference/design-taste-frontend.md` §0 (Read the Room) before writing UI.
2. **Apply the always-on rules** from the references: typography scale, color calibration, spacing rhythm, responsive hard-rules, and the anti-slop / AI-tells checklist. These are mandatory for every UI task.
3. **Decide depth:**
   - **Minor change** (button, copy, single component tweak) → apply the rules directly, no escalation.
   - **UI-centric work** (a landing, a dashboard, a full page or redesign) → escalate to the `impeccable` engine: invoke its matching sub-command (`craft`/`shape` to build, `polish`/`audit`/`critique` to refine) per its routing rules.
4. **Self-check** against the anti-slop checklist before declaring the UI task done.

## Escalation contract

When escalating, hand impeccable the surface/target and the Design Direction. impeccable owns its own flow from there; return to the calling execution skill when it finishes.

## Boundaries

- Does NOT design screens from scratch in a tool — that is `ui-design` (Stitch), which runs earlier in the pipeline.
- Does NOT do backend/API/CLI work.
