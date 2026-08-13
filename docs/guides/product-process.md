# Running the product process

The layer **before** development: taking a raw idea or an unformed need and maturing it until it's something worth building — then handing it over as a certified brief.

It exists because of a specific, expensive failure: an agent given a vague idea will happily start designing and coding, inventing the business answers as it goes. Those invented answers are invisible afterwards — they look like decisions someone made. The product layer forces the business questions to be asked and answered *before* any code.

## When this is the right entry point

| The session starts with | Go to |
|---|---|
| An idea or intuition without a formed requirement | **product-process** — this page |
| A request to evaluate or extract an existing architecture | **product-process** |
| An existing brief to resume | **product-process** |
| A concrete requirement over code | [development-process](development-process.md) |
| A certified-ready brief, ready to build | [development-process](development-process.md) |
| Ambiguous | **Ask.** "Mature the idea, or build now?" Never guess. |

The distinction that matters: **`product-discovery` explores the problem space; `brainstorming` explores the solution space.** `brainstorming` belongs to development-process and is the wrong tool for a raw business idea.

---

## The modes

| Mode | Skill | Trigger | Output |
|---|---|---|---|
| Discovery | `product-discovery` | A raw idea, an intuition, an unformed problem | Problem framing, JTBD, business cases |
| Structuring | `product-brief` | A matured idea that needs a formal document | A brief conforming to the contract, sealed by the readiness gate |
| Assessment | `architecture-assessment` | "Does this architecture hold up?" | Findings + recommendations, prioritised by severity |
| Extraction | `architecture-extraction` | "Document what we actually have" | arc42-lite + C4 views of the current system |
| Certification | `readiness-gate` | Any document claiming to be a brief | A per-criterion **G1–G9** verdict written into the document's frontmatter |

Assessment and extraction change nothing — they only read and report. Extraction before extension is the brownfield rule: **document what exists before touching it.**

---

## The flow

```
   idea ──► product-discovery ──► product-brief ──► readiness-gate ──► development-process
                problem space        the document      G1–G9 verdict      solution space
```

### 1 · Discovery — one question at a time

`product-discovery` works the problem space at **business level**, deliberately not technical. What's the actual problem? Who has it? What do they do today? What would have to be true for this to be worth building?

It asks **one question at a time** on purpose. A wall of ten questions gets a shallow answer to each.

### 2 · Structuring — the brief

`product-brief` turns the matured idea into a document that conforms to the brief contract. The brief is the **baton**: it's the only thing that crosses from the product layer to development. Context that isn't in the brief doesn't cross.

### 3 · Certification — the readiness gate

`readiness-gate` evaluates **G1–G9** against the brief's *actual content* — never against a seal it's already carrying. A brief that was certified before an edit is not certified after it.

The gate runs twice: at creation, and again at the crossing into development. That second run is the one that catches drift.

### 4 · Handoff

A brief with verdict `ready` is handed to `development-process`, which passes it to `brainstorming` in Brief Preload Mode — the design phase starts *from* the brief instead of re-litigating it.

---

## Open decisions (`DA-#`)

The mechanism that keeps the boundary honest.

When a business-level unknown appears **mid-development** — a missing business case, an unresolved product decision — the rule is explicit:

> Do **not** improvise the answer.

Instead: record it as an open decision (`DA-#`) in the source brief, and offer to return to `product-process` to mature it.

> **The boundary is always crossed through the door.**

Returning to the product layer is an explicit act via `product-process` — never an improvised business answer inside a development session. This is what stops invented business answers from being laundered into the codebase as if someone had decided them.

If there is no source brief (the work started as a concrete requirement), note the gap in the current plan or design doc, and mention `product-process` as the way to formalise it.

---

## Architecture assessment vs. advisory

Three different things, easy to confuse:

| You want | Use |
|---|---|
| A standalone, portable, re-ingestible evaluation report | `architecture-assessment` (via product-process) |
| A documented view of the architecture that exists today | `architecture-extraction` (via product-process) |
| A quick opinion mid-conversation, no artifact | `architecture-advisor` directly |

`architecture-assessment` itself calls `architecture-advisor` for targeted opinions, so they compose rather than compete.

---

## Anti-loss rules

The product and development orchestrators are siblings with an explicit boundary. Three rules keep work from evaporating between them:

1. **One orchestrator active at a time.** Never both.
2. **The brief is the baton.** Context crosses only inside the artifact — not in conversational memory, which doesn't survive a new session.
3. **Return through the door.** Going from development back to product happens via `product-process`, explicitly.

---

## Driving it manually

In agents that don't enforce (OpenCode, Cursor, Copilot, Antigravity):

```
"Use the product-discovery skill — I have an idea about <X>."
"Now structure that into a brief with product-brief."
"Run readiness-gate on that brief."
"The brief is ready — hand it to development-process."
```

---

## Related

- [Development process](development-process.md) — what happens after the handoff
- [How AWM works](../framework.md) — the whole lifecycle end to end
- [Runbook](../runbook.md) — install, project setup, team rollout
