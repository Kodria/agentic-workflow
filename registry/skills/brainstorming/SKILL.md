---
name: brainstorming
version: "1.0.0"
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Checklist

You MUST create a task for each of these items and complete them in order:

1. **Explore project context** — check files, docs, recent commits
2. **Offer visual companion** (if topic will involve visual questions) — this is its own message, not combined with a clarifying question. See the Visual Companion section below.
3. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to their complexity, get user approval after each section
6. **UI Screen detection** — during/after presenting the design, evaluate if the feature needs UI screens (see the UI Screen Detection section)
7. **Write design doc** — save to `docs/plans/YYYY-MM-DD-<topic>-design.md` (including the `## UI Screens` table when applicable) and commit
8. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
9. **User reviews written spec** — ask the user to review the spec file before proceeding
10. **Transition to next step** — if the design doc has `## UI Screens` with pending screens, invoke `ui-design`; otherwise invoke `writing-plans`

## Process Flow

```dot
digraph brainstorming {
    "Explore project context" [shape=box];
    "Visual questions ahead?" [shape=diamond];
    "Offer Visual Companion\n(own message, no other content)" [shape=box];
    "Ask clarifying questions" [shape=box];
    "Propose 2-3 approaches" [shape=box];
    "Present design sections" [shape=box];
    "User approves design?" [shape=diamond];
    "UI screens detected?" [shape=diamond];
    "Confirm UI design phase\nwith user" [shape=box];
    "Write design doc\n(+ UI Screens table if accepted)" [shape=box];
    "Spec self-review\n(fix inline)" [shape=box];
    "User reviews spec?" [shape=diamond];
    "Has pending UI Screens?" [shape=diamond];
    "Invoke ui-design skill" [shape=doublecircle];
    "Invoke writing-plans skill" [shape=doublecircle];

    "Explore project context" -> "Visual questions ahead?";
    "Visual questions ahead?" -> "Offer Visual Companion\n(own message, no other content)" [label="yes"];
    "Visual questions ahead?" -> "Ask clarifying questions" [label="no"];
    "Offer Visual Companion\n(own message, no other content)" -> "Ask clarifying questions";
    "Ask clarifying questions" -> "Propose 2-3 approaches";
    "Propose 2-3 approaches" -> "Present design sections";
    "Present design sections" -> "User approves design?";
    "User approves design?" -> "Present design sections" [label="no, revise"];
    "User approves design?" -> "UI screens detected?" [label="yes"];
    "UI screens detected?" -> "Confirm UI design phase\nwith user" [label="yes"];
    "UI screens detected?" -> "Write design doc\n(+ UI Screens table if accepted)" [label="no"];
    "Confirm UI design phase\nwith user" -> "Write design doc\n(+ UI Screens table if accepted)";
    "Write design doc\n(+ UI Screens table if accepted)" -> "Spec self-review\n(fix inline)";
    "Spec self-review\n(fix inline)" -> "User reviews spec?";
    "User reviews spec?" -> "Write design doc\n(+ UI Screens table if accepted)" [label="changes requested"];
    "User reviews spec?" -> "Has pending UI Screens?" [label="approved"];
    "Has pending UI Screens?" -> "Invoke ui-design skill" [label="yes"];
    "Has pending UI Screens?" -> "Invoke writing-plans skill" [label="no"];
}
```

**The terminal state is invoking either `ui-design` or `writing-plans`:**
- If the design doc contains a `## UI Screens` section with pending screens → invoke `ui-design`
- Otherwise → invoke `writing-plans`

Do NOT invoke any other implementation skill.

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → plan → implementation cycle.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently
- For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?
- Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.
- Smaller, well-bounded units are also easier for you to work with - you reason better about code you can hold in context at once, and your edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design - the way a good developer improves code they're working in.
- Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## After the Design

**Documentation:**

- Write the validated design (spec) to `docs/plans/YYYY-MM-DD-<topic>-design.md`
  - (User preferences for spec location override this default)
- Use elements-of-style:writing-clearly-and-concisely skill if available
- Commit the design document to git

**Spec Self-Review:**

After writing the spec document, look at it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review — just fix and move on.

**User Review Gate:**

After the spec review loop passes, ask the user to review the written spec before proceeding:

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user's response. If they request changes, make them and re-run the spec review loop. Only proceed once the user approves.

**Next step routing:**

- If the design doc has a `## UI Screens` section with pending screens → invoke `ui-design`
- Otherwise → invoke `writing-plans` to create a detailed implementation plan
- Do NOT invoke any other skill.

## UI Screen Detection

During the "Presenting the design" phase, evaluate whether the feature involves UI screens that would benefit from visual design with Stitch:

**Criteria (all must be true):**
1. The feature has direct user interaction (not purely backend, API, or CLI)
2. It requires new screens or significant layout changes
3. The visual complexity justifies a designer (a button text change does not)

**If UI screens are detected:**

After the user approves the full design, identify any UI screens detected. Before finalizing the design doc, ask the user:

> "I detected N screens that could benefit from UI design with Stitch: [list screens]. Do you want to go through the UI design phase or skip it?"

- **User accepts** → write the design doc including a `## UI Screens` section with a table:

```markdown
## UI Screens

| Screen | Description | Device | Status |
|--------|-------------|--------|--------|
| [name] | [description] | [MOBILE/DESKTOP/TABLET] | pending |
```

- **User skips** → write the design doc WITHOUT the `## UI Screens` section. Then invoke `writing-plans` directly.

**If no UI screens detected:** Do not add the section. Proceed directly to `writing-plans`.

> **Routing contract:** The `development-process` orchestrator and the `ui-design` skill route based on the presence of a `## UI Screens` table with at least one row where `Status` is exactly `pending`. Always use `pending` (lowercase) as the initial status value — using any other value will break routing.

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design, get approval before moving on
- **Be flexible** - Go back and clarify when something doesn't make sense

## Visual Companion

A browser-based companion for showing mockups, diagrams, and visual options **during brainstorming**. Available as a tool — not a mode. Accepting the companion means it's available for questions that benefit from visual treatment; it does NOT mean every question goes through the browser.

**Visual Companion vs `ui-design`:** these are different phases.
- **Visual Companion** is for *discovery-time* questions: low-fidelity wireframes used as input to a brainstorming choice (e.g. "which layout direction feels right?"). Local HTML, zero API cost, mockups are disposable.
- **`ui-design`** is for *production-time* screens: high-fidelity Stitch generations consumed by implementation. Invoked AFTER the design doc is written, when a `## UI Screens` table with `pending` rows exists.

They are complementary and run at different points in this skill: Visual Companion may be used at step 2 onward; `ui-design` is the terminal transition at step 10.

**Offering the companion:** When you anticipate that upcoming questions will involve visual content (mockups, layouts, diagrams), offer it once for consent:
> "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)"

**This offer MUST be its own message.** Do not combine it with clarifying questions, context summaries, or any other content. The message should contain ONLY the offer above and nothing else. Wait for the user's response before continuing. If they decline, proceed with text-only brainstorming.

**Per-question decision:** Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. The test: **would the user understand this better by seeing it than reading it?**

- **Use the browser** for content that IS visual — mockups, wireframes, layout comparisons, architecture diagrams, side-by-side visual designs
- **Use the terminal** for content that is text — requirements questions, conceptual choices, tradeoff lists, A/B/C/D text options, scope decisions

A question about a UI topic is not automatically a visual question. "What does personality mean in this context?" is a conceptual question — use the terminal. "Which wizard layout works better?" is a visual question — use the browser.

If they agree to the companion, read the detailed guide before proceeding:
`skills/brainstorming/visual-companion.md`

## Specialist Skills Awareness

During the approach exploration phase (Propose 2-3 approaches), if you detect the conversation involves decisions of significant complexity in these areas, you may invoke the corresponding specialist skill in **contextual mode** to enrich the discussion:

| Area | Skill | When to invoke |
|------|-------|----------------|
| Architecture design | `architecture-advisor` | Designing system architecture, choosing patterns, defining components, evaluating integrations |
| CI/CD pipeline | `cicd-proposal-builder` | Defining delivery pipeline, branching strategy, environments, deploy strategy |
| Non-functional requirements | `nfr-checklist-generator` | Identifying and prioritizing NFRs early in design |
| Technology selection | `technology-evaluator` | Evaluating and comparing technology options with structured criteria |

**Rules:**
- Only invoke for decisions of **significant complexity** — do not invoke for trivial choices.
- Invoke in **contextual mode** — the specialist answers a specific question and returns control to you.
- The specialist's output is integrated into the design document you are building, not written as a separate artifact.
- You remain in control of the brainstorming flow. The specialist is a consultant, not a replacement.
