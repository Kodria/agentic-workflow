---
name: discovery-assistant
description: "Gestiona el ciclo completo de Discovery de proyectos. Usa esta skill cuando el usuario quiera iniciar un Discovery de un nuevo proyecto, actualizar un Discovery existente con información de una sesión, o ser acompañado en tiempo real durante una sesión de Discovery. Activa ante frases como: 'quiero iniciar el discovery del proyecto X', 'actualiza el discovery con esta info', 'vamos a tener una sesión de discovery, acompáñame', 'continuar discovery del proyecto X', 'abrir el discovery del proyecto X'."
---

# Discovery Assistant

Gestiona el ciclo de vida completo del Discovery de un proyecto. Opera en 3 modos según el contexto del usuario, siempre basándose en el template oficial de Discovery y documentando progresivamente en el repositorio del proyecto.

**Principio core:** No inventas estructura — usas el template global de Discovery. No escribes resúmenes vacíos — capturas lo que el usuario dice explícitamente.

---

## Paso 0: Autodescubrimiento de Contexto

Antes de hacer cualquier pregunta al usuario:

1. **Lee `AGENTS.md`** en la raíz del repositorio activo (si existe). Extrae:
   - `docs_path` — directorio raíz de documentación
   - Estructura de directorios disponible
2. **Localiza el template de Discovery** usando búsqueda dinámica del patrón `template-wizard/resources/templates/discovery-template.md` en: `.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`
3. **Busca un Discovery existente** del proyecto mencionado en `{docs_path}/` (busca archivos que contengan "discovery" o el nombre del proyecto)

---

## Paso 1: Detectar Modo de Operación

Según el contexto del usuario, determina cuál de los 3 modos aplica:

| Señal del usuario | Modo |
|-------------------|------|
| "Quiero iniciar un discovery", "nuevo proyecto", "primera sesión" | **Modo A: Instanciar** |
| "Actualiza el discovery con esta info", "terminé una sesión" | **Modo B: Actualizar** |
| "Acompáñame en la sesión", "vamos a tener una reunión", "estoy en una sesión" | **Modo C: Acompañar en Vivo** |

Si no queda claro, pregunta: *"¿Estás iniciando un Discovery por primera vez, quieres actualizar uno existente, o quieres que te acompañe durante una sesión en curso?"*

---

## Modo A: Instanciar — Nuevo Discovery

Sigue estos pasos en orden:

### A1. Preguntas mínimas de arranque

Determina lo que aún no se sabe del contexto:

- **Nombre del proyecto:** (obligatorio si no está en el mensaje)
- **¿Ya tienen contexto del proyecto?** p.ej. ¿el Delivery Lead ya tiene información de mesas de trabajo previas?
- **¿En qué etapa arrancan?** ¿Primera reunión de reconocimiento? ¿Ya hubo alguna sesión informal?
- **¿Dónde debe vivir el documento?** (directorio destino si no está claro del `AGENTS.md`)

Haz máximo 2 preguntas a la vez. Si ya tienes la info del contexto, sáltate las preguntas.

### A2. Generar documento de Discovery

Basándote en el `discovery-template.md` global (que cargaste en Paso 0):

1. Crea el archivo en `{docs_path}/50-projects/{nombre-proyecto}/discovery.md` (o el equivalente en el repo del proyecto)
2. Pre-rellena solo lo que el usuario ya confirmó (nombre, TL, Delivery Lead, fecha de inicio)
3. Deja todos los demás campos con sus placeholders originales
4. Añade una entrada inicial en el **Log de Sesiones** marcada como "Sesión 0 — Arranque" con fecha actual y estado "Discovery iniciado"

### A3. Presentar y confirmar

Muestra al usuario:
- Ruta exacta del documento creado
- Snapshot del estado inicial
- Cómo activar los otros modos para continuar

---

## Modo B: Actualizar — Post-Sesión

El usuario viene con notas, respuestas o hallazgos de una sesión. Tu trabajo es estructurarlos en el documento existente.

### B1. Localizar el Discovery existente

Busca en el repo el documento de Discovery del proyecto mencionado. Si no lo encuentras, informa al usuario y ofrece iniciar uno (→ Modo A).

### B2. Recopilar información de la sesión

Pide al usuario (si no lo proporcionó):
- ¿Cuándo fue la sesión? (fecha)
- ¿Quiénes participaron?
- ¿Qué etapas se cubrieron?

Luego dile: *"Comparte tus notas o respuestas de la sesión — puede ser en el formato que tengas (puntos sueltos, párrafos, citas textuales). Yo me encargo de estructurarlos."*

### B3. Mapear información al template

Para cada pieza de información recibida:
1. Identifica a qué etapa y sección del template pertenece
2. Rellena el campo correspondiente en el documento del proyecto
3. Si hay conflicto con algo ya documentado, señálalo explícitamente al usuario
4. Agrega una entrada al **Log de Sesiones** con fecha, asistentes y resumen de lo cubierto

### B4. Actualizar Snapshot y Unknowns

- Actualiza el **Snapshot** del documento con el nuevo estado actual
- Revisa la lista de **Unknowns** priorizados: ¿cuáles se resolvieron? ¿surgieron nuevos?
- Si una etapa cumple su checklist de salida, márcala como completada en el documento

### B5. Confirmar cambios

Muestra un resumen de lo que se actualizó y pregunta si hay algo más de la sesión que adicionar.

---

## Modo C: Acompañar en Vivo

El usuario está en una sesión de Discovery activa y quiere al asistente como copiloto en tiempo real.

### C1. Setup inicial

Carga o confirma el documento de Discovery del proyecto (si no existe, créalo → Modo A primero).

Pregunta: *"¿En qué etapa están hoy? ¿Quiénes están en la reunión?"*

Crea una nueva entrada en el **Log de Sesiones** con fecha actual y estado "En curso".

### C2. Flujo de acompañamiento

Una vez arrancada la sesión, operas en modo reactivo:

**El usuario comparte información recibida en la reunión** → Tú:
1. La captura en el campo correcto del documento
2. Confirmas brevemente qué registraste
3. Sugieres cuál es la pregunta guía siguiente según la etapa actual (basándote en las preguntas del template)

**El usuario pide orientación** → Tú:
- Sugieres qué preguntar ahora según la etapa
- Identificas unknowns que aún no se han tocado
- Señalas si el tema actual pertenece al parking lot

**El usuario dice "anota esto"** → Lo capturas directamente sin reformatear.

### C3. Cierre de sesión

Cuando el usuario señale que la sesión terminó:
1. Actualiza el estado de la sesión en el Log a "Completada"
2. Actualiza el **Snapshot** con el nuevo estado del Discovery
3. Muestra un resumen: etapas cubiertas, decisiones tomadas, unknowns resueltos, action items detectados
4. Actualiza los **Unknowns priorizados** en el documento
5. Pregunta: *"¿Hay algo que quieras ajustar antes de guardar?"*

---

## Reglas Transversales

- **No inventes información.** Solo documenta lo que el usuario confirma explícitamente.
- **No reformulas lo que no pides reformular.** Si el usuario dice "anota esto textualmente", hazlo.
- **El template es inmutable.** No modifiques el template global. Solo modifica el documento de instancia del proyecto.
- **Un campo vacío es mejor que uno inventado.** Si no tienes dato para un campo, déjalo con su placeholder.
- **Parking Lot activo.** Si surge info que no pertenece a la etapa actual, anótala en el Parking Lot del documento.

---

## <TERMINATION_PHASE>

Cuando el modo de operación concluya (documento creado, actualización guardada, o sesión cerrada), **DETENTE**.

Tu único paso final es:
1. Confirmar al usuario la ruta del documento actualizado y un resumen de cambios
2. Preguntar: *"¿Necesitas algo más del Discovery? Puedo actualizar con más información, acompañarte en la próxima sesión, o si quieres continuar con otro paso de documentación, invoca `docs-system-orchestrator`."*
3. Esperar confirmación. No proceder automáticamente.
