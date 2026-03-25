# Stitch UI Design Integration — Design Document

## Summary

Integrate a UI/UX design phase into the agentic development pipeline using Google Stitch via MCP. The new phase sits between `brainstorming` and `writing-plans` as an optional step, activated when brainstorming detects that the feature requires new screens.

## Pipeline (updated)

```
New task → brainstorming → ui-design (optional) → writing-plans → execution → finishing
```

The `ui-design` phase is skipped when:
- Brainstorming determines no UI is needed (no `## UI Screens` section in design doc)
- The user explicitly declines the design phase when prompted

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Design system reuse | Reuse if exists, create if not | Consistency without friction |
| Output artifact | References only (Stitch IDs in design doc) | Lightweight; HTML extracted during execution when needed |
| UI detection | Brainstorming evaluates internally | It already understands the feature scope |
| Iteration model | Screen by screen, sequential | More control, less rework, aligns with Stitch best practices |

## Component 1: New skill `ui-design`

### Responsibility

Read screens from the design doc's `## UI Screens` table, generate them in Stitch one by one, iterate with user feedback, and update the design doc with Stitch references.

### Internal flow

```
Read design doc
  → Detect/reuse Stitch project (by feature name convention)
  → Detect/reuse design system
    → If none exists: ask user (describe vibe | derive from URL/image | skip)
    → If exists: reuse silently
  → For each screen with status "pending":
      → Build prompt from screen description + design doc context
      → generate_screen_from_text (GEMINI_3_1_PRO by default)
      → Present result to user
      → Loop: user requests changes → edit_screens / generate_variants → present again
      → User approves → update design doc table (status: completed, stitch screen ID)
  → All screens completed → invoke writing-plans
```

### MCP tools used

| Tool | Purpose |
|------|---------|
| `create_project` | Create Stitch project for the feature |
| `get_project`, `list_projects` | Detect existing project |
| `generate_screen_from_text` | Generate screen from description |
| `edit_screens` | Refine screen based on user feedback |
| `generate_variants` | Explore alternative designs when user requests |
| `get_screen` | Retrieve screen details and status |
| `create_design_system`, `update_design_system` | Create/configure design system |
| `list_design_systems` | Detect existing design system |
| `apply_design_system` | Apply design system to screens |

### Stitch naming conventions

- **Project name:** Same as the feature/topic from the design doc
- **Screen names:** Match the "Screen" column in the UI Screens table

### Models

- Default: `GEMINI_3_1_PRO` (high quality, production candidates)
- User can request `GEMINI_3_FLASH` for rapid wireframing

### Terminal state

Invoke `writing-plans`. No other skill.

## Component 2: Modifications to `brainstorming`

### UI detection

During the "Presenting the design" phase, brainstorming evaluates:
1. Does the feature have direct user interaction? (not just backend/API/CLI)
2. Does it require new screens or significant layout changes?
3. Does the visual complexity justify a designer? (a button text change doesn't)

### Design doc changes

If UI is detected, brainstorming adds this section to the design doc before committing:

```markdown
## UI Screens

| Screen | Description | Device | Status |
|--------|-------------|--------|--------|
| Login | Login screen with email and OAuth | MOBILE | pending |
| Dashboard | Main view with key metrics | DESKTOP | pending |
```

### Skip mechanism

After detecting screens, brainstorming asks:
> "I detected N screens that could benefit from UI design with Stitch. Do you want to go through the UI design phase or skip it?"

- Accept → adds `## UI Screens` section, recommends `ui-design` as next step
- Skip → no section added, invokes `writing-plans` directly

### Terminal state change

- Design doc has `## UI Screens` with pending screens → recommend `ui-design`
- Design doc has no `## UI Screens` → invoke `writing-plans` (unchanged behavior)

## Component 3: Modifications to `development-process`

### Updated state machine

| Files found | State | Next action |
|-------------|-------|-------------|
| No design or plan files for the topic | **New** | → `brainstorming` |
| `*-design.md` with `## UI Screens` and pending screens | **UI Design pending** | → `ui-design` |
| `*-design.md` without `## UI Screens` or all screens completed, no `*-plan.md` | **Designed** | → `writing-plans` |
| `*-plan.md` with incomplete tasks | **Executing** | → execution skill |
| `*-plan.md` with all tasks complete | **Finishing** | → `finishing-a-development-branch` |

### Updated pipeline table

| Phase | Skill | Trigger | Output |
|-------|-------|---------|--------|
| 1. Design | `brainstorming` | New feature/task | Design doc with optional UI Screens section |
| 1.5. UI Design | `ui-design` | Design doc with UI Screens pending | Design doc updated with Stitch IDs |
| 2. Planning | `writing-plans` | Design doc without pending UI | Implementation plan |
| 3. Execution | `executing-plans` / `subagent-driven` | Plan ready | Code committed |
| 4. Completion | `finishing-a-development-branch` | All tasks done | Merge/PR |

### Detection logic

When the orchestrator reads a design doc, before recommending `writing-plans`, it checks:
1. Does `## UI Screens` section exist?
2. Are there screens with status `pending`?

Both yes → recommend `ui-design`. Otherwise → recommend `writing-plans`.

## File changes

| Action | File |
|--------|------|
| Create | `registry/skills/ui-design/SKILL.md` |
| Modify | `registry/skills/brainstorming/SKILL.md` |
| Modify | `registry/skills/development-process/SKILL.md` |

## Design doc artifact after UI design (example)

```markdown
## UI Screens

> Stitch Project: `projects/abc123`

| Screen | Description | Device | Status | Stitch Screen |
|--------|-------------|--------|--------|---------------|
| Login | Login screen with email and OAuth | MOBILE | completed | screens/xyz1 |
| Dashboard | Main view with key metrics | DESKTOP | completed | screens/xyz2 |
| Settings | Profile configuration | MOBILE | completed | screens/xyz3 |
```
