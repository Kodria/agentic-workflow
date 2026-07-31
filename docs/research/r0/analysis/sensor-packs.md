# Sensor-packs — mapeo conceptual→real (R6, Step 1)

**Fuente:** `/home/user/awm-baseline-registry/sensor-packs/` (repo sibling, solo lectura — este análisis no modifica nada ahí).

## Estructura observada

```
sensor-packs/
├── generic/
│   ├── .semgrep.awm.yml     # 1 regla: awm-generic-no-hardcoded-secrets
│   └── pack.json            # declara 1 sensor: security (semgrep)
└── js-ts/
    ├── .dep-cruiser.awm.js
    ├── .semgrep.awm.yml     # 3 reglas: awm-no-eval, awm-no-hardcoded-secrets, awm-no-sql-concat
    ├── eslint.config.awm.cjs
    ├── eslint.config.awm.mjs
    ├── pack.json            # declara 6 sensores: typecheck, lint, security, depcheck, test, mutation
    └── tsconfig.awm.json
```

Cada pack tiene exactamente dos tipos de archivo:

1. **`pack.json`** — el manifiesto declarativo. Enumera los `sensors` del pack (nombre, `defaultCmd`, `configFile`, `formatter`, `fast`, `enabled`). Ejemplo real, `js-ts/pack.json`:
   ```json
   {
     "name": "js-ts",
     "description": "JavaScript / TypeScript sensor pack",
     "detects": ["package.json"],
     "sensors": {
       "typecheck": { "fast": true, "defaultCmd": "npx tsc --noEmit", "formatter": "tsc" },
       "lint": { "fast": true, "defaultCmd": "npx eslint . --config eslint.config.awm.mjs --cache --format json", "configFile": "eslint.config.awm.mjs", "configFileFallback": "eslint.config.awm.cjs", "formatter": "eslint-llm" },
       "security": { "fast": false, "defaultCmd": "semgrep --config .semgrep.awm.yml --json .", "configFile": ".semgrep.awm.yml", "formatter": "semgrep" },
       "depcheck": { "fast": false, "defaultCmd": "npx depcruise --config .dep-cruiser.awm.js {{SOURCE_DIRS}}", "configFile": ".dep-cruiser.awm.js", "formatter": "generic" },
       "test": { "fast": false, "enabled": true, "defaultCmd": "npm test --silent", "formatter": "test" },
       "mutation": { "fast": false, "enabled": false, "defaultCmd": "npx stryker run", "formatter": "generic" }
     }
   }
   ```
   Nótese el campo top-level `"detects": []` (vacío en `generic`, `["package.json"]` en `js-ts`) — ya existe un slot para "qué activa este pack", pero **no** existe hoy un campo equivalente para "qué clases de defecto cubre este pack".

2. **Los `configFile` reales que cada sensor invoca** — `.semgrep.awm.yml`, `eslint.config.awm.{mjs,cjs}`, `.dep-cruiser.awm.js`, `tsconfig.awm.json`. Son los archivos que un proyecto copia a su raíz al correr `awm sensors init` (evidencia: `cli/.awm/sensors.json` del propio repo CLI referencia exactamente estos mismos nombres — `eslint.config.awm.mjs`, `.semgrep.awm.yml`, `.dep-cruiser.awm.js` — confirmando que son plantillas, no metadatos internos del registry).

   Contenido real de `sensor-packs/js-ts/.semgrep.awm.yml` (3 reglas, cada una con un `id` legible como slug de clase de problema):
   - `awm-no-eval` — `eval(...)` es riesgo de ejecución arbitraria.
   - `awm-no-hardcoded-secrets` — `const $VAR = "..."` con nombre sospechoso (`password|secret|api_key|apikey|token|passwd`).
   - `awm-no-sql-concat` — concatenación de string en query SQL.

   `sensor-packs/generic/.semgrep.awm.yml` tiene solo 1 regla (`awm-generic-no-hardcoded-secrets`, versión agnóstica-a-lenguaje de la misma clase).

No hay ningún tercer tipo de archivo en el árbol (no hay `README`, `CHANGELOG`, ni un archivo de metadatos de "clases cubiertas" separado del `configFile`).

## ¿Dónde encajaría un "set de referencia de clases de defecto" sin rediseño?

**Sí encaja, como un campo nuevo en `pack.json`, sin tocar la estructura existente.** Razonamiento:

- `pack.json` ya es el único punto de metadatos declarativos del pack (nombre, detección, lista de sensores) — es el lugar natural para declarar también qué *clases de defecto* cubre, porque ya juega ese rol para "qué stack activa el pack" (`detects`) y "qué comandos corre" (`sensors`).
- El vocabulario de "clase de defecto" ya existe implícitamente en los `id` de las reglas Semgrep (`awm-no-eval`, `awm-no-hardcoded-secrets`, `awm-no-sql-concat` en `sensor-packs/js-ts/.semgrep.awm.yml`) — cada `id` es, de hecho, el nombre de una clase de defecto genérica. Un campo `pack.json` como `"coversDefectClasses": ["eval-arbitrary-exec", "hardcoded-secrets", "sql-injection-concat"]` sería una lista derivable 1:1 de los `id` ya presentes, sin inventar un nuevo formato de archivo.
- El consumidor de ese campo (PR-1 del brief, "detección de cobertura de sensores": *"¿qué clases de defecto no tienen detector mecánico acá?"*) necesita comparar un **set de referencia de clases** contra lo que el pack instalado realmente cubre. Ese set de referencia puede vivir como un array plano en `pack.json` (o un `pack.json` adicional a nivel de registry, ej. `sensor-packs/defect-classes.json`, con un catálogo compartido entre `generic` y `js-ts`) — ninguna opción exige cambiar el mecanismo de instalación, detección (`detects`) o ejecución (`defaultCmd`/`configFile`) que ya existe.
- Confirmación cruzada con el propio repo CLI: `cli/.awm/sensors.json` (el manifiesto *instalado*, resultado de `awm sensors init` sobre el pack `js-ts`) tiene la misma forma `{ pack, sensors: { <nombre>: { cmd, fast, enabled? } } }` que `pack.json` — es decir, el manifiesto instalado es un subconjunto/copia del pack de origen. Agregar un campo de clases cubiertas al `pack.json` de origen se propagaría al manifiesto instalado con el mismo mecanismo de copia que ya mueve `sensors`, sin necesitar lógica nueva de instalación.

**Conclusión: sí, un set de referencia de clases de defecto encaja en `pack.json` (o un catálogo hermano en el mismo directorio) sin rediseñar la estructura de sensor-packs — el vocabulario de "clase de defecto" ya existe de facto en los `id` de reglas Semgrep, solo falta declararlo explícitamente a nivel de pack.**
