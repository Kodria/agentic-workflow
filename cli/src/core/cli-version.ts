// src/core/cli-version.ts
//
// Versión del propio CLI. Funciona compilado (dist/src/core) y en ts-node
// (src/core): sube directorios hasta encontrar el package.json del paquete.
import fs from 'fs';
import path from 'path';

export const CLI_PACKAGE_NAME = 'agentic-workflow-manager';

/**
 * Directorio raíz del paquete del CLI — el que contiene SU package.json, no el
 * del proyecto del usuario. Devuelve null si no aparece en la cadena de padres.
 */
export function packageRoot(from: string = __dirname): string | null {
    let dir = from;
    for (let i = 0; i < 6; i++) {
        const p = path.join(dir, 'package.json');
        if (fs.existsSync(p)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
                if (pkg.name === CLI_PACKAGE_NAME) return dir;
            } catch { /* package.json ajeno o ilegible — seguir subiendo */ }
        }
        dir = path.dirname(dir);
    }
    return null;
}

export function cliVersion(): string {
    const root = packageRoot();
    if (!root) return '0.0.0';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        if (typeof pkg.version === 'string') return pkg.version;
    } catch { /* ilegible entre el walk y la lectura */ }
    return '0.0.0';
}
