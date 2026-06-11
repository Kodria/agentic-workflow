// src/core/cli-version.ts
//
// Versión del propio CLI. Funciona compilado (dist/src/core) y en ts-node
// (src/core): sube directorios hasta encontrar el package.json del paquete.
import fs from 'fs';
import path from 'path';

export const CLI_PACKAGE_NAME = 'agentic-workflow-manager';

export function cliVersion(): string {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        const p = path.join(dir, 'package.json');
        if (fs.existsSync(p)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
                if (pkg.name === CLI_PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
            } catch { /* package.json ajeno o ilegible — seguir subiendo */ }
        }
        dir = path.dirname(dir);
    }
    return '0.0.0';
}
