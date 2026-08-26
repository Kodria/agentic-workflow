<!-- awm-context:CTX-CONSTITUTION-046 -->
## Decisión pendiente registrada — piso organizacional de sensores

<!-- awm-context:CTX-CONSTITUTION-047 -->
**Qué es:** un conjunto mínimo de reglas de sensor obligatorias en TODOS los proyectos de la organización, impuesto por AWM independientemente de lo que cada proyecto configure en su propio `.awm/sensors.json`. Hoy la configuración de sensores es 100% per-proyecto: cada repo declara su pack y sus reglas via `awm sensors init`, sin ningún piso corporativo que un equipo no pueda bajar o desactivar.

<!-- awm-context:CTX-CONSTITUTION-048 -->
**Por qué se pospone:** decisión explícita del owner, no un gap por omisión (ver `docs/plans/2026-08-07-team-rollout-hardening-design.md`, "Fuera de alcance": *"Piso de política organizacional de sensores (mínimos obligatorios) — se documenta como decisión pendiente en CONSTITUTION, no se implementa"*). Documentarlo aquí no implementa nada — el objetivo es dejar constancia de que la pregunta se hizo y se pospuso a propósito, con criterio, no por descuido. A la fecha de R7 (2026-08-08) no hay evidencia de drift entre equipos que lo justifique: el gobierno de AWM sigue siendo unipersonal (un solo owner/maintainer publica CLI y registry — ver design doc, "Contexto y problema") y un solo registry base (`awm-baseline-registry`) es consumido por todos los proyectos conocidos hoy. Un piso organizacional resuelve un problema de MÚLTIPLES equipos divergiendo en direcciones distintas; imponerlo sin ese problema real sería sensor-pack especulativo — la misma clase de error que este repo ya prohíbe para reglas nacidas de un bug puntual de un proyecto (ver CLAUDE.md, "Sensores y packs — frontera genérico/específico"): no se hornea una regla — ni un piso — sin evidencia de recurrencia real.

<!-- awm-context:CTX-CONSTITUTION-049 -->
**Qué lo activaría** (cualquiera de estas señales basta, no hace falta que ocurran todas):
- Un segundo equipo (o más) adoptando AWM con configuraciones de sensores lo bastante divergentes como para que un hallazgo de seguridad genérico (eval, secrets, SQL injection, validación de entradas) quede deshabilitado en un proyecto sin que nadie lo haya decidido explícitamente — un opt-out accidental, no uno declarado.
- Un incidente de seguridad trazable a un proyecto sub-configurado: un sensor que un piso organizacional hubiera exigido y ese proyecto nunca activó.
- Evidencia acumulada — vía `harness-retro`/ledger, el mismo mecanismo que hoy cura reglas específicas de proyecto — de que una clase de hallazgo genérica se repite cruzando proyectos porque cada equipo la configuró desde cero, en vez de heredarla de un piso común.

<!-- awm-context:CTX-CONSTITUTION-050 -->
Hasta que aparezca una de esas señales, la respuesta correcta sigue siendo la que ya rige: `.awm/sensors.json` per-proyecto, sensor-packs genéricos y agnósticos a clase de problema en el registry (frontera ya codificada en CLAUDE.md), y reglas específicas creciendo project-local vía `harness-retro`. Esta entrada existe para que la próxima vez que alguien proponga un piso organizacional, la pregunta no se reabra desde cero sin memoria de por qué se pospuso la primera vez.
