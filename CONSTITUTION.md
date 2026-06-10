# AWM — Constitution

Reglas de proceso del proyecto. Todo agente que trabaje en este repo debe leerlas y aplicarlas.

---

## Validación de entrada

- **Al escribir un guard de nombre/componente de path, rechazar el conjunto completo de entradas peligrosas: string vacío, `.`, `..`, `/`, `\\`.** Nunca enumerar solo los patrones que se te ocurran. Un guard que rechaza `..` y `/` pero deja pasar `.` sigue siendo una vulnerabilidad de path traversal — `path.join('registries', '.')` resuelve al directorio padre. Usar siempre `name === '.' || name.includes('..') || /[/\\]/.test(name) || !name` como base.

## Implementación

- **Al conectar una función nueva que reemplaza un call directo en múltiples puntos (p.ej. un resolver que reemplaza una constante hardcodeada), buscar TODOS los call-sites con `grep` antes de marcar el task completo.** El plan puede no listar módulos secundarios. En WS-2, `init/steps.ts` quedó sin wiring porque el plan solo mencionaba `index.ts`; el spec-reviewer lo detectó pero solo después del commit. Comando de referencia: `grep -rn "syncRegistry\b" src/ --include="*.ts"`.

- **En handlers de comando con early-exits de conveniencia (`if (x.length === 0) return`), los gates de contrato —versión, seguridad, permisos— deben ir ANTES del early-exit.** El early-exit elimina trabajo innecesario; el gate verifica un invariante. Si el gate queda después, cualquier flujo que toma el early-exit lo saltea en silencio. Caso WS-3: `awm sync` tenía el early-exit de extensiones vacías antes del gate de versión — proyectos con `registries` pineados pero sin extensiones pasaban sin verificar el pin.
