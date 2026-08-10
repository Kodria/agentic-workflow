#!/usr/bin/env node
// Aplica el trabajo de un track: reemplaza el contenido de UN archivo.
//
// Los dos valores llegan por argv y se escriben con `fs`, nunca por shell. Un fixture que
// interpolara en una shell haría que el propio E2E dependa del quoting de la plataforma,
// que es la clase de bug que este repo ya arregló dos veces (`shellQuote` en Windows).
import fs from 'node:fs';
import path from 'node:path';

const [, , file, value] = process.argv;
if (typeof file !== 'string' || typeof value !== 'string') {
    console.error('uso: apply-task.mjs <archivo> <valor>');
    process.exit(2);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${value}\n`);
