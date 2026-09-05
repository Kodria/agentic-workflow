# Resolución de `orchestrator.name` contra skills configurados — Diseño

Issue: GitHub #110
Estado: aprobado

## Decisión

Una declaración de orquestador puede resolver a un skill de cualquier registry
configurado y seguro. La existencia se obtiene de la unión de skills descubiertos
en cada `contentRoot()` por separado. No se exige que el skill esté materializado
para un proveedor: el contexto compuesto es global y agnóstico del proveedor.

## Requisitos

- **R110-1** — SI `orchestrator.name` no coincide con ningún skill descubierto
  en los registries configurados y seguros, ENTONCES AWM SHALL omitir la
  declaración y emitir un diagnóstico accionable.
- **R110-2** — SI el nombre coincide con un skill de cualquier registry
  configurado y seguro, ENTONCES AWM SHALL conservar la declaración.
- **R110-3** — SI falla el discovery de un root, ENTONCES AWM SHALL
  diagnosticarlo y continuar con los restantes.
- **R110-4** — `readDeclaredOrchestrators()` SHALL seguir validando sólo la
  forma; `collectDeclaredOrchestrators()` SHALL resolver semánticamente el nombre.
- **R110-5** — SI `terminatesTo` no está disponible, ENTONCES AWM SHALL
  conservar el orquestador y degradar al ruteo normal conforme a R3.3.
- **R110-6** — SI `--verify <name>` recibe una declaración omitida por R110-1,
  ENTONCES SHALL devolver código 2.
- **R110-7** — SI una declaración inválida convive con sanas, ENTONCES AWM
  SHALL componer las sanas sin abortar.

## Límites

No cambia la instalación de bundles, `artifact-state`, perfiles ni la semántica
de `terminatesTo`. El discovery se ejecuta por root para conservar la degradación
fail-safe existente en `core/process/discover.ts`.
