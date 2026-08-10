#!/usr/bin/env node
// Comando canónico de integración del workload: sale 0 SOLO si los dos archivos tienen
// su valor final. Es el criterio que prueba que la integración vio el trabajo de AMBOS
// tracks — un merge que perdiera uno de los dos deja este verificador en rojo.
import fs from 'node:fs';

const expected = { 'src/a.txt': 'A-final', 'src/b.txt': 'B-final' };
const wrong = Object.entries(expected).filter(([file, value]) => {
    try { return fs.readFileSync(file, 'utf8').trim() !== value; } catch { return true; }
});
if (wrong.length > 0) {
    console.error(`verify: faltan valores finales en ${wrong.map(([f]) => f).join(', ')}`);
    process.exit(1);
}
