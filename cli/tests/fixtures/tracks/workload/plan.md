# Workload determinista de dos tracks

Fixture del E2E de aceptación de R5 (CA-4.1–CA-4.3). Dos tracks que tocan archivos
disjuntos, así que la evaluación de independencia declarada tiene que decir `parallel`.

El comando de integración es un **array**, no prosa: es lo que hace que la selección del
comando sea mecánica y no interpretable (C4).

## Tracks

**Integration argv:** ["node","cli/tests/fixtures/tracks/workload/verify.mjs"]
**Integration paths:** ["src/**"]

| Track | Depends on | Shared resources |
|---|---|---|
| a | none | [] |
| b | none | [] |

### Task 1: Track A

**Track:** a
**Files:**
- Modify: `src/a.txt`

### Task 2: Track B

**Track:** b
**Files:**
- Modify: `src/b.txt`
