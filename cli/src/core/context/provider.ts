// cli/src/core/context/provider.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AwmContext } from './types';
import { DeclaredOrchestrator } from '../orchestrators';
import { sanitizeDeclaredField } from '../text';

export function sha256(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

export type ContextInput = {
    registryRoot: string;
    profileExtensions: string[];
    /** Declaraciones recolectadas de todos los registries instalados. Ausente o
     *  vacio => payload byte-identico al previo a este cambio (R6.1). */
    declaredOrchestrators?: DeclaredOrchestrator[];
};

function parseVersion(skill: string): string {
    const m = skill.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
    return m ? m[1].trim() : '0.0.0';
}

/**
 * La lista de orquestadores declarados TAL COMO entra al payload de contexto:
 * saneada campo por campo con `sanitizeDeclaredField` (core/text.ts) — que
 * neutraliza tanto marcado markdown/saltos de linea (prompt-injection via
 * `##`, `` ` ``, `*`, `_`, `<`, `>`) COMO bytes de control C0/DEL (ANSI
 * escapes hacia una terminal real). `readDeclaredOrchestrators` solo valida
 * que los campos sean strings no vacios; el saneo pertenece a esta frontera
 * de render, no a la validacion de lectura.
 *
 * ESTA es la UNICA funcion que hace este saneo — es la que consume
 * `renderDeclared` (el payload materializado en cada sesion de agente via
 * `buildContext`) y la que consume `awm context orchestrators` (comando).
 * Ningun consumidor necesita sanear de nuevo por su cuenta: si el comando
 * aplicara su propio saneo, comando y payload podrian divergir en silencio
 * — el modo de falla que R5.2 prohíbe para el modelo de proceso y que vale
 * igual acá. Por la misma razon, cualquier comparacion contra un nombre
 * declarado (p.ej. `--verify` en `commands/context/index.ts`) debe normalizar
 * su lado tambien con `sanitizeDeclaredField`, no con una copia del regex.
 */
export function composedOrchestrators(list: DeclaredOrchestrator[]): DeclaredOrchestrator[] {
    return list.map(o => ({
        name: sanitizeDeclaredField(o.name),
        appliesWhen: sanitizeDeclaredField(o.appliesWhen),
        terminatesTo: sanitizeDeclaredField(o.terminatesTo),
    }));
}

function renderDeclared(list: DeclaredOrchestrator[]): string {
    if (list.length === 0) return '';
    const rows = composedOrchestrators(list)
        .map(o => `- **${o.name}** — applies when: ${o.appliesWhen}. Terminates to: \`${o.terminatesTo}\`.`)
        .join('\n');
    return `## Declared orchestrators\n\nConsider these before the built-in pair:\n\n${rows}\n\n`;
}

export function buildContext(input: ContextInput): AwmContext {
    const skillPath = path.join(input.registryRoot, 'skills/using-awm/SKILL.md');
    if (!fs.existsSync(skillPath)) {
        throw new Error(`using-awm skill not found at ${skillPath}. Run 'awm update' first.`);
    }
    const skill = fs.readFileSync(skillPath, 'utf-8');
    const exts = input.profileExtensions.length ? input.profileExtensions.join(', ') : 'none';
    const header = `<!-- AWM context (generated) -->\n# AWM\n\nActive extensions: ${exts}\n\n`;
    const declared = renderDeclared(input.declaredOrchestrators ?? []);
    const markdown = header + declared + skill;
    return { markdown, sourceVersion: parseVersion(skill), contentHash: sha256(markdown) };
}
