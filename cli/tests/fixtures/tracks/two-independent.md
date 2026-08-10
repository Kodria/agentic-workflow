# Fixture

## Tracks

**Integration argv:** ["npm","test","--","--runInBand"]
**Integration paths:** ["cli/src/**","cli/tests/**"]

| Track | Depends on | Shared resources |
|---|---|---|
| cli | none | [] |
| docs | none | [] |

### Task 1: CLI

**Track:** cli
**Files:**
- Modify: `cli/src/a.ts`

### Task 2: Docs

**Track:** docs
**Files:**
- Modify: `docs/a.md`
