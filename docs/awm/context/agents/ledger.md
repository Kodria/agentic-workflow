<!-- awm-context:CTX-AGENTS-055 -->
## Ledger y trazabilidad

<!-- awm-context:CTX-AGENTS-056 -->
- **`awm ledger add` puede correr dos veces para el mismo hallazgo — leer `awm ledger list` completo, no confiar en el conteo de `awm ledger recurring` a ciegas.** *(≥4 veces en un solo release: entradas con `phase`+`signature`+`desc` byte-idénticos y timestamps a milisegundos, más entradas de prueba que algún subagente dejó al verificar que `awm` respondía.)* El riesgo: `recurring --min 2` cuenta duplicados exactos como 2 ocurrencias reales, empujando de forma espuria un hallazgo trivial a "sistémico" en el triage desatendido de `harness-retro`. Reconciliar contra el contenido real, no contra el resumen en prosa de cada subagente.

<!-- awm-context:CTX-AGENTS-057 -->
- **Depurar contra evidencia real (logs de CI, stack traces) sin invocar `systematic-debugging` deja el ledger vacío aunque haya hallazgos reales — y un ledger vacío con hallazgos reales es en sí mismo el hallazgo de retro.** *(Un ciclo de varias rondas de fixes contra CI real de `windows-latest` (~137 fallos → 0, incluida una reversión arquitectónica) produjo CERO entradas, porque el trabajo se hizo leyendo logs y parcheando directamente. `harness-retro` detectó el vacío contra la evidencia de la sesión y reconstruyó el registro post-hoc.)* **Al confirmar una causa raíz depurando directamente, emitir el `awm ledger add --phase debugging --polarity finding ...` igual** — el skill formaliza el paso, pero la obligación de loguear no depende de invocarlo.
