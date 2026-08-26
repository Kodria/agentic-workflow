<!-- awm-context:CTX-CONSTITUTION-040 -->
## Fase de documentación — obligatoria y observable

<!-- awm-context:CTX-CONSTITUTION-041 -->
Todo ciclo de desarrollo termina con su documentación de usuario final al día. La fase corre entre `post-implementation-qa` y `harness-retro`, y cierra escribiendo `<!-- awm-docs-complete: YYYY-MM-DD -->` en el plan activo.

<!-- awm-context:CTX-CONSTITUTION-042 -->
**Esta regla no se sostiene por estar escrita acá.** Se sostiene porque hay mecanismo: `development-process` rutea a `post-implementation-docs` cuando `awm-qa-complete` está y `awm-docs-complete` falta, y no avanza a retro ni a `finishing-a-development-branch` sin el marker; `classifyPlanState` (`cli/src/core/dashboard/plan-state.ts`) clasifica ese estado como `docs_pending` y `awm doctor` lo muestra. El enunciado de esta sección explica **por qué**; lo que la hace cumplir es la cadena de markers.

<!-- awm-context:CTX-CONSTITUTION-043 -->
La razón de que esté acá y no solo en el código: la documentación de usuario final de AWM no deriva de golpe, deriva un cambio por vez, y cada cambio individual siempre parece demasiado chico como para justificar una pasada de documentación. `AGENTS.md` → "Patrones de documentación" tiene la evidencia de qué pasa cuando nadie paga ese costo en el momento: narrativa de comandos con errores factuales que sobrevivió spec-review y code-quality-review, porque la revisión leyó prosa en vez de ejecutar el binario.

<!-- awm-context:CTX-CONSTITUTION-044 -->
Por eso la fase tiene una obligación que no es negociable: **documentar contra el binario, nunca contra la prosa**. Una afirmación sobre un comando que no se ejecutó no se escribe.

<!-- awm-context:CTX-CONSTITUTION-045 -->
La fase es post-plan, o sea que corre del lado desatendido de la frontera descrita arriba. Está diseñada para ser resoluble por un agente solo, y su degradación es honesta: si el registry de documentación (opt-in) no está instalado, la fase corre igual con instrucciones genéricas y **nunca** bloquea el cierre de la rama.
