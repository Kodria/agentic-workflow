# Auditoría de evidencia Codex — estado para retomar

Fecha: 2026-07-31. Alcance revisado: commit `252bcef` y requisitos R0/R10.

## Veredicto corregido

La corrida `codex@agentmobile-linux` es evidencia suplementaria de un sandbox
Linux. No satisface la fila obligatoria `codex@máquina-del-dueño` y no permite
declarar completa la porción Codex de Fase B.

Estado de los ejercicios de esa corrida:

- P1 despacho/paralelismo: `soportado` — 20+20 timestamps con 15.159 s de
  solapamiento real.
- P2 override de modelo: `no-certificado` — faltan modelo observado del
  controlador y metadatos durables del despacho.
- P3 proceso vivo tras fin de turno: `no-certificado` — hay 180.287 s de
  heartbeats posteriores al timestamp, pero ningún artefacto distingue el
  turno de reanudación.
- P4 worktree: `no-certificado` — la transcripción sustituyó la salida crítica
  del árbol principal por un comentario.
- P5 recuperación: `no-certificado` — marker y resumed se produjeron en la
  misma conversación con memoria previa.
- P6 espera/polling: `no-certificado`, como ya estaba declarado.

La sonda histórica de `rename` también quedó rebajada a `no-certificado`: solo
leía el contenido final. La implementación actual usa un lector concurrente y
requiere observar ambos payloads completos, sin ausencias ni contenidos
inesperados.

## Secuencia exacta en la máquina del dueño

1. Actualizar esta rama y usar una etiqueta estable real, por ejemplo
   `owner-mac`.
2. Ejecutar `node docs/research/r0/probes/run.mjs --provider codex --env owner-mac`.
3. Ejecutar `AGENT-PROTOCOL.md` completo con artefactos nuevos. No reutilizar ni
   renombrar los de `agentmobile-linux`.
4. En P2 conservar identificadores observados y procedencia del controlador,
   worker y dispatch; si el harness no los expone, registrar `no-certificado`.
5. En P3 conservar el artefacto de reanudación de otro turno. En P4 guardar
   stdout/stderr literal. En P5 cerrar realmente la app/CLI y volver en una
   sesión sin memoria.
6. Repetir los pasos 2–5 desde OpenCode con `--provider opencode`.
7. Commitear y pushear toda la evidencia nueva. Solo entonces ejecutar Tasks
   12–13; Task 14 sigue siendo la validación interactiva del dueño.

Mientras no existan corridas nuevas de Codex y OpenCode en la máquina del
dueño, R0 permanece bloqueado por diseño.
