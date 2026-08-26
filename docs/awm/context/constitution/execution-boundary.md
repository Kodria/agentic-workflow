<!-- awm-context:CTX-CONSTITUTION-035 -->
## Frontera atendido/desatendido

<!-- awm-context:CTX-CONSTITUTION-036 -->
Esta sección **cita** una regla ya vigente (ver "`~/.awm` es territorio del instalador — NUNCA tocarlo" en CLAUDE.md) como política de producto explícita — no la duplica ni la reinterpreta. El modo de ejecución (atendido: con check-ins humanos entre fases; desatendido: autónomo, sin pausas de confirmación — ver `docs/plans/2026-08-07-team-rollout-hardening-plan.md`, "Modo de ejecución") decide cuánta supervisión humana media entre tareas. **Nunca decide qué fronteras de propiedad puede cruzar el agente.**

<!-- awm-context:CTX-CONSTITUTION-037 -->
Concretamente: ni siquiera en modo desatendido una sesión de desarrollo en este repo gana permiso para escribir, editar o "arreglar" algo bajo `~/.awm`, ni para atajear la latencia `editar registry → awm update` copiando contenido directamente a la instalación. La velocidad de una corrida autónoma nunca es justificación para cruzar esa frontera — si el agente detecta un problema bajo `~/.awm`, lo reporta; no lo "arregla en carne propia" porque nadie está mirando en ese momento.

<!-- awm-context:CTX-CONSTITUTION-038 -->
La misma forma de frontera aparece en cómo el CLI trata herramientas externas que no controla: `checkHost` (`cli/src/commands/preflight/checks.ts`) y las skills `finishing-a-development-branch`/`receiving-code-review` degradan honestamente cuando `gh`/`glab` faltan — en modo desatendido, "push + URL de compare/new-MR + reporte explícito de qué faltó" es un final **VÁLIDO**, nunca un fallo mudo en el último paso. El patrón general: cuando la ejecución autónoma llega a un límite que no puede cruzar (una herramienta ausente, un territorio ajeno como `~/.awm`), la respuesta correcta es degradar de forma honesta y visible — no forzar el cruce, y no fallar en silencio.

<!-- awm-context:CTX-CONSTITUTION-039 -->
Lo que SÍ cubre "desatendido" (mandato citado en el plan R7 y aplicado en R1–R6): ejecución completa sin pausas de check-in entre tareas ni entre fases; triage de hallazgos con criterio propio del agente (`harness-retro` descarta sin preguntar lo que no es valor real, recurrente o sistémico); corrección de TODOS los hallazgos de QA que surjan, no una selección manual; cierre de rama vía PR directo, sin presentar el menú de 4 opciones. Lo que "desatendido" **nunca** releva: los gates de contrato — versión, seguridad, permisos —, que van siempre ANTES de cualquier early-exit de conveniencia (ver "Implementación" arriba); ni la frontera de `~/.awm` descrita en este párrafo.
