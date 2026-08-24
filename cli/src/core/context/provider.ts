// cli/src/core/context/provider.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AwmContext } from './types';
import { DeclaredOrchestrator } from '../orchestrators';

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
 * Neutraliza contenido no confiable proveniente de registries declarados
 * (name/appliesWhen/terminatesTo) antes de interpolarlo en markdown.
 * Sin esto, un registry malicioso/comprometido podria inyectar saltos de
 * linea, marcadores markdown (##, `, *, _) o pseudo-tags XML/HTML (<, >)
 * para forjar una seccion nueva o un bloque instruccional dentro del
 * payload de contexto que consume el proveedor de IA — un vector de
 * prompt-injection. `readDeclaredOrchestrators` solo valida que los
 * campos sean strings no vacios; el saneo pertenece a esta frontera de
 * render, no a la validacion de lectura.
 */
function sanitizeForMarkdown(s: string): string {
    return s.replace(/\r?\n/g, ' ').replace(/[`*_#<>]/g, '');
}

/**
 * La lista de orquestadores declarados TAL COMO entra al payload de contexto:
 * saneada campo por campo con `sanitizeForMarkdown`.
 *
 * Exportada porque `awm context orchestrators` debe poder mostrar exactamente
 * lo que el agente va a recibir, no una segunda derivación de los mismos datos.
 * Si el comando aplicara su propio saneo, comando y payload podrían divergir en
 * silencio — el modo de falla que R5.2 prohíbe para el modelo de proceso y que
 * vale igual acá.
 */
export function composedOrchestrators(list: DeclaredOrchestrator[]): DeclaredOrchestrator[] {
    return list.map(o => ({
        name: sanitizeForMarkdown(o.name),
        appliesWhen: sanitizeForMarkdown(o.appliesWhen),
        terminatesTo: sanitizeForMarkdown(o.terminatesTo),
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
