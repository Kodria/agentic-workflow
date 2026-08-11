# R2 — Detección estática de cobertura de sensores

**Issue:** [#20](https://github.com/Kodria/agentic-workflow/issues/20)

**Brief fuente:** `docs/plans/2026-07-30-sdd-cycle-optimization-brief.md`

**Decisiones vigentes:** D-013 y D-014 de `docs/decisions.md`

**Estado:** diseño aprobado el 2026-08-11

## Requirements

- **RF-1.1** — WHEN se invoca `awm sensors coverage` sobre un proyecto configurado cuyo pack declara referencia, THE comando SHALL reportar cada clase esperada como `covered`, `missing` o `unverifiable`, incluyendo cada detector presente cuya configuración efectiva no demuestre cobertura.
- **RF-1.4** — THE comando SHALL ser íntegramente read-only y SHALL NOT escribir en el proyecto, `.awm/`, `AWM_HOME` ni ningún registry.
- **RF-1.5** — IF el pack no declara un contrato de cobertura, THEN THE comando SHALL devolver `inconclusive/no_reference` como estado distinto de `covered`.
- **RNF-T.2** — THE comando SHALL conservar una semántica provider-neutral y SHALL producir el mismo contrato de resultado en Claude Code y Codex.
- **RNF-T.3** — THE referencia de cada pack SHALL declarar exclusivamente clases genéricas de defecto reutilizables entre proyectos.
- **R2.1** — THE referencia de cobertura SHALL vivir bajo `coverage` en `sensor-packs/<pack>/pack.json`, SHALL declarar `schemaVersion: 1` y SHALL mapear IDs estables de clase a descripción, detectores y remedio.
- **R2.2** — WHEN una clase declara varios detectores, THE evaluador SHALL considerar la clase cubierta si al menos un detector queda demostrado; dentro de cada detector, THE evaluador SHALL exigir toda la evidencia declarada.
- **R2.3** — WHEN un sensor esperado no existe o está deshabilitado, THE evaluador SHALL clasificar su clase como `missing` y SHALL identificar el detector como `missing` o `disabled`.
- **R2.4** — WHEN un sensor está activo pero su comando, archivo o marcador requerido no coincide, THE evaluador SHALL clasificar el detector como `ineffective` y la clase como `missing` si ninguna alternativa queda demostrada.
- **R2.5** — IF existe un candidato pero su evidencia no puede inspeccionarse de forma segura, THEN THE evaluador SHALL clasificarlo como `unverifiable` y SHALL NOT convertirlo en verde ni en ausencia confirmada.
- **R2.6** — IF `.awm/sensors.json` no existe, THEN THE comando SHALL devolver `inconclusive/not_configured`, SHALL sugerir `awm sensors init` y SHALL terminar con exit `0`.
- **R2.7** — IF `.awm/sensors.json`, `pack.json` o el contrato `coverage` existe pero es malformado o usa una versión desconocida, THEN THE comando SHALL fallar con un error accionable y exit distinto de cero.
- **R2.8** — WHEN el comando produce un reporte, THE CLI SHALL mostrar una vista humana por defecto y SHALL emitir un envelope JSON versionado al recibir `--json`.
- **R2.9** — WHEN el reporte contiene gaps, evidencia no verificable o falta de referencia/configuración, THE comando SHALL terminar con exit `0`; solamente los errores de lectura o contrato SHALL terminar con exit distinto de cero.
- **R2.10** — THE resultado SHALL ordenar las clases por ID y SHALL ser determinista para entradas idénticas.
- **R2.11** — THE evaluador SHALL inspeccionar únicamente paths relativos al proyecto, SHALL rechazar traversal y symlinks, SHALL limitar a 1 MiB cada JSON o archivo de evidencia leído y SHALL usar coincidencias literales en vez de regex provistas por el registry.
- **R2.12** — THE CLI SHALL resolver el primer registry configurado que contenga el pack exacto solicitado y SHALL identificar ese registry en el reporte.
- **R2.13** — THE CLI SHALL tolerar packs antiguos sin `coverage` como `inconclusive/no_reference` y SHALL NOT exigir migración para ejecutar los demás comandos de sensores.
- **R2.14** — THE envelope JSON SHALL reservar una sección `static` estable y SHALL permitir que R3 agregue una sección opcional `empirical` sin alterar la semántica de R2.
- **R2.15** — THE entrega inicial SHALL incluir contratos de cobertura para `generic`, `js-ts`, `python` y `shell`; SHALL excluir cobertura de mutación del set requerido mientras el propio pack distribuya ese sensor deshabilitado por defecto.

## Contexto y alcance

R2 responde una pregunta read-only: **“¿qué clases de defecto que este pack considera esperables no tienen cobertura mecánica demostrable en este proyecto?”** La referencia pertenece al pack y se versiona con él; el CLI solamente valida, compara y reporta.

La feature cubre dos repositorios:

- `awm-baseline-registry`: declara la referencia y los remedios de los cuatro packs baseline.
- `agentic-workflow`: implementa resolución, validación, evaluación y render del reporte.

R2 implementa únicamente la mitad estática de PR-1. R3 consumirá su mismo vocabulario para cruzarlo con clusters del ledger.

## Non-goals

- Instalar herramientas, ejecutar remedios o modificar `.awm/sensors.json`.
- Ejecutar sensores para inferir cobertura.
- Parsear semánticamente configuraciones específicas de ESLint, Semgrep, Ruff, mypy, ShellCheck u otras herramientas.
- Convertir gaps en una compuerta de CI o de cierre del ciclo.
- Implementar el cruce empírico con el ledger; pertenece a R3.
- Declarar mutation testing como cobertura baseline mientras continúe deshabilitado por defecto.
- Crear UI gráfica o pantallas.

## Decisiones de diseño

### Propiedad del conocimiento

D-013 fija la frontera: el registry declara qué espera cada stack y el CLI compara. El CLI no contiene listas hardcodeadas de clases, sensores o herramientas concretas.

D-014 fija la frontera de side effects: el reporte nombra un remedio, pero nunca lo ejecuta ni cambia configuración.

### Criterio fail-closed de configuración efectiva

Una clase puede tener uno o más detectores alternativos. Un detector se demuestra solo cuando:

1. el sensor nombrado está presente y activo en `.awm/sensors.json`; y
2. su comando contiene todos los fragmentos literales requeridos; y
3. existen todos los archivos de evidencia declarados; y
4. cada archivo contiene todos sus marcadores literales requeridos.

La ausencia o discordancia observable es un gap confirmado. La imposibilidad de leer evidencia de forma segura es `unverifiable`. Esta separación evita tanto falsos verdes como afirmar ausencia cuando el CLI carece de prueba.

## Arquitectura

### Registry: contrato declarativo

Cada `pack.json` puede añadir:

```json
{
  "coverage": {
    "schemaVersion": 1,
    "classes": {
      "formatting": {
        "description": "Consistencia mecánica de formato",
        "detectors": [
          {
            "sensor": "format",
            "evidence": {
              "commandIncludes": ["prettier"],
              "files": [
                {
                  "path": ".prettierrc",
                  "containsAll": []
                }
              ]
            }
          }
        ],
        "remedy": {
          "summary": "Agregar un formatter mecánico al proyecto",
          "command": "npm install --save-dev prettier"
        }
      }
    }
  }
}
```

Reglas del contrato:

- `schemaVersion` es obligatorio y vale exactamente `1`.
- `classes` es un objeto no vacío indexado por slug `/^[a-z][a-z0-9-]*$/`.
- `description`, `remedy.summary` y `remedy.command` son strings no vacíos.
- `detectors` es un array no vacío.
- `sensor` es un nombre no vacío y seguro como componente lógico; puede nombrar un sensor que el pack no instala por defecto, porque precisamente puede representar un gap y su remedio.
- `evidence` es opcional; la presencia activa del sensor es siempre el piso. Si existe, admite `commandIncludes` y `files`.
- `commandIncludes` contiene strings literales no vacíos; todos deben aparecer en `cmd`.
- `files` contiene paths relativos seguros y un `containsAll` de strings literales; todos los archivos y marcadores son obligatorios dentro del detector.
- Varios detectores expresan alternativas OR; las evidencias dentro de uno expresan condiciones AND.
- Campos desconocidos se rechazan para que un typo no rebaje cobertura en silencio.

### CLI: módulos y responsabilidades

La implementación se separa en unidades enfocadas bajo `cli/src/commands/sensors/coverage/`:

1. `contract.ts`: tipos runtime, guards recursivos y normalización del bloque `coverage` leído como `unknown`.
2. `resolve.ts`: localiza el manifiesto del proyecto y el primer content root configurado que contiene `sensor-packs/<pack>/pack.json`; devuelve también el nombre del registry.
3. `evidence.ts`: inspecciona comandos y archivos locales con límites de seguridad, sin ejecutar ni importar código.
4. `evaluate.ts`: función pura que transforma contrato, manifiesto y observaciones en resultados por detector/clase.
5. `render.ts`: salida humana y envelope JSON.
6. `index.ts`: orquestación del subcomando y traducción explícita de resultados/errores a exit codes.

Las funciones públicas validan argumentos y fallan explícitamente ante entradas inválidas.

## Flujo de datos

1. Partir del `cwd` recibido o `process.cwd()`.
2. Buscar el ancestro más cercano con `.awm/sensors.json`, reutilizando la semántica de `findManifestDir`.
3. Si no existe, producir `inconclusive/not_configured` y detener la lectura.
4. Leer y validar estrictamente el manifiesto como `unknown`.
5. Resolver el pack exacto en los registries configurados, en orden.
6. Leer y validar `pack.json` con límite de 1 MiB.
7. Si `coverage` no existe, producir `inconclusive/no_reference`.
8. Recoger observaciones seguras de cada detector.
9. Evaluar clases de manera pura.
10. Ordenar por ID y renderizar la vista humana o JSON.

No existe ningún paso de escritura ni lanzamiento de subprocesos.

## Modelo de resultado

### Estados por detector

- `covered`: sensor activo y toda evidencia satisfecha.
- `missing`: sensor no configurado.
- `disabled`: sensor configurado con `enabled: false`.
- `ineffective`: sensor activo, pero falta o no coincide evidencia requerida.
- `unverifiable`: existe candidato, pero una lectura segura no puede decidir.

### Estados por clase

- `covered`: al menos un detector alternativo está `covered`.
- `missing`: ningún detector está cubierto y existe ausencia, deshabilitación o inefectividad demostrada.
- `unverifiable`: ningún detector está cubierto y no puede probarse ausencia efectiva porque al menos uno quedó `unverifiable` sin ningún gap confirmado.

### Precedencia global

1. Sin manifiesto o sin referencia: `inconclusive` con razón explícita.
2. Con referencia y alguna clase `missing`: `gaps`.
3. Sin clases `missing`, pero con alguna `unverifiable`: `inconclusive`.
4. Todas las clases `covered`: `covered`.

Si coexisten gaps y clases no verificables, `overall` es `gaps`, pero el reporte conserva ambas categorías y no afirma que el análisis sea completo.

### Envelope JSON

```json
{
  "schemaVersion": 1,
  "pack": "js-ts",
  "registry": "baseline",
  "overall": "gaps",
  "static": {
    "status": "gaps",
    "reason": null,
    "classes": [
      {
        "id": "formatting",
        "description": "Consistencia mecánica de formato",
        "status": "missing",
        "detectors": [],
        "remedy": {
          "summary": "Agregar un formatter mecánico al proyecto",
          "command": "npm install --save-dev prettier"
        }
      }
    ]
  }
}
```

R3 puede añadir `empirical` como campo top-level opcional. No cambiará `schemaVersion: 1` mientras el significado y shape de los campos existentes permanezca compatible; una ruptura real exige una versión nueva.

### Salida humana

La vista por defecto muestra:

- pack y registry de referencia;
- estado global;
- una línea por clase no cubierta, con estado y detector causal;
- remedio propuesto;
- resumen de clases cubiertas, ausentes y no verificables.

No imprime contenido de archivos inspeccionados ni oculta estados no verdes.

## Errores y seguridad

| Situación | Resultado | Exit |
|---|---|---:|
| Sin `.awm/sensors.json` | `inconclusive/not_configured` + `awm sensors init` | 0 |
| Pack sin `coverage` | `inconclusive/no_reference` | 0 |
| Gaps o evidencia no verificable | reporte completo | 0 |
| Manifiesto malformado | error accionable con path | ≠0 |
| `pack.json` malformado o mayor de 1 MiB | error accionable con path | ≠0 |
| `coverage` malformado o versión desconocida | error accionable con campo/path | ≠0 |
| Path contractual absoluto, vacío, `.`, `..` o traversal | error de contrato | ≠0 |
| Archivo de evidencia ausente o marcador no encontrado | detector `ineffective` | 0 |
| Archivo de evidencia symlink, ilegible o mayor de 1 MiB | detector `unverifiable` | 0 |

Los archivos se inspeccionan con `lstat`; un symlink nunca se dereferencia. Los marcadores son coincidencias literales, no regex. El renderer solo expone IDs, paths declarados y estados, nunca el contenido leído.

## Catálogo inicial de referencia

El catálogo exacto se derivará de los sensores y reglas que cada pack distribuye en el momento de implementación. Su alcance aprobado es:

| Pack | Clases baseline |
|---|---|
| `generic` | secretos hardcodeados |
| `js-ts` | tipos estáticos; errores básicos de lint; convenciones propias del proyecto; formato mecánico; dependencias; regresión; ejecución dinámica; secretos hardcodeados; construcción insegura de SQL |
| `python` | tipos estáticos; lint; regresión; ejecución dinámica; shell inseguro en subprocess; construcción insegura de SQL; deserialización insegura; secretos hardcodeados |
| `shell` | corrección ShellCheck; `eval`; pipe remoto a shell; sustitución de comando sin quoting; secretos hardcodeados |

Cada entrada debe ser genérica y trazable a evidencia real del pack. Mutation testing queda excluido del set requerido mientras siga deshabilitado por defecto.

## Compatibilidad y evolución

- Los comandos existentes ignoran el campo top-level `coverage`; su comportamiento no cambia.
- Un CLI nuevo frente a un pack antiguo informa `no_reference`.
- El contrato se valida por `schemaVersion`; versiones futuras desconocidas fallan explícitamente.
- La resolución usa el orden de `registries.json` y busca el pack exacto, en vez de asumir que el primer registry con cualquier `sensor-packs/` lo contiene.
- El resultado nombra el registry fuente para que la precedencia sea auditable.
- El vocabulario de IDs creado en R2 será la clave de unión que use R3 con el ledger.

## Testing y aceptación

La implementación seguirá TDD. Cada fix descubierto durante revisión tendrá un test discriminante verificado con ciclo rojo/verde por reversión del fix.

### CLI

- Corpus negativo del contrato: tipos incorrectos, campos desconocidos, arrays vacíos, versión futura, IDs inválidos, paths hostiles y strings vacíos.
- Tests puros de todas las combinaciones de detectores y de la precedencia de estados.
- Tests de resolución multi-registry y del registry fuente reportado.
- Tests de evidencia: comando, archivos, marcadores, ausencia, permisos, symlink y límite de tamaño.
- Tests de render humano y JSON sin depender de color TTY.
- Tests del wiring Commander, `--json` y exit codes.
- Test read-only con hashes del árbol del proyecto y de un `AWM_HOME` aislado antes/después.
- Test de compatibilidad con pack sin `coverage`.

### Registry

- Validador estructural que recorre los cuatro `pack.json` y aplica el mismo contrato público.
- Prueba de que cada detector referencia evidencia existente o un remedio explícito.
- Revisión de RNF-T.3: ninguna clase o descripción nombra un proyecto específico.
- Mutaciones deliberadas que rompen una regla/marker y demuestran que el gate falla o que la evaluación pierde cobertura según corresponda.

### Acceptance

- Fixture versionado, sanitizado y con hash/comando de reproducción, derivado del estado real citado por CA-1.1.
- E2E adicional contra el checkout real de `agentic-workflow`: debe detectar ausencia de formatter y ausencia de configuración de convenciones propia del proyecto mientras esas premisas sigan vigentes; si el repo cambia, la evidencia de aceptación registra el nuevo estado sin convertirlo en fixture mutable.
- Verificación read-only mediante hashes antes/después.
- Ejecución con el CLI compilado localmente: `npm run build && node dist/src/index.js sensors coverage`, nunca con el `awm` global.
- Evidencia reproducible de la misma semántica en Claude Code y Codex.

## Entrega coordinada

1. PR en `agentic-workflow`: contrato, evaluador, comando, tests y documentación de CLI.
2. PR en `awm-baseline-registry`: referencias de los cuatro packs, pruebas, bump del bundle correspondiente y release automático del registry.

El CLI se entrega primero para que el nuevo contenido tenga consumidor publicado. Si el registry necesita protegerse de un CLI anterior por algún comportamiento concreto —no por la mera presencia del campo ignorado— actualizará `minCliVersion` al mínimo real.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El contrato crece hasta convertirse en un lenguaje de reglas | Solo primitivas literales AND y alternativas por detector; sin regex, scripts ni parsers de herramientas |
| Falsos verdes por sensor presente con configuración mínima | Evidencia explícita y fail-closed; presencia sola solo basta si el pack lo declara deliberadamente |
| Falsos gaps ante configuración personalizada | Alternativas declarativas; si no puede demostrarse equivalencia, `unverifiable` en vez de `covered` |
| Pack de terceros intenta leer fuera del proyecto | Paths validados, `lstat`, sin symlinks, límite de tamaño y cero impresión de contenidos |
| Drift entre contratos del registry y el consumidor CLI | Contrato versionado, corpus compartido conceptualmente y E2E coordinado entre repos |
| IDs demasiado específicos impiden R3 | RNF-T.3, catálogo inicial mínimo y revisión por clase antes del release |

## UI

No aplica. R2 es una capacidad CLI sin pantallas ni cambios de layout.
