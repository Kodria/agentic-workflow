// cli/src/core/process/discover.ts
// Enumera modelos de proceso entre todos los registries instalados.
//
// Reusa discoverSkills (core/discovery.ts) para listar cada root: no re-camina
// el filesystem, delega en ella la lectura del directorio `skills/` y la
// descripción del SKILL.md. Pero se la llama UN ROOT A LA VEZ, no con todos
// los roots juntos.
//
// Motivo: discoverSkills lanza cuando dos roots tienen una skill con el MISMO
// nombre de carpeta y ningún override declarado — esa es la política correcta
// para identidad de skill, pero un modelo de proceso se identifica por su
// `name` de frontmatter, no por el nombre de su carpeta. Si se le pasaran
// todos los roots juntos, una colisión de nombre-de-carpeta entre dos
// registries (con o sin relación entre sí) tumbaría el descubrimiento de
// TODOS los modelos de proceso de TODOS los registries — justo lo que R7.1
// prohíbe. El dedupe real de modelos ocurre acá abajo, por `name`, con
// diagnóstico en vez de excepción; ver `collectDeclaredOrchestrators` para el
// mismo criterio ("gana el primero en orden de roots").
import fs from 'fs';
import path from 'path';
import { contentRoots } from '../registries';
import { discoverSkills } from '../discovery';
import { parseProcessFrontmatter } from './model';
import { parseProcessBody } from './body';
import type { ProcessModel } from './types';

export interface DiscoveredProcessModels { models: ProcessModel[]; diagnostics: string[] }

export function discoverProcessModels(roots: string[] = contentRoots()): DiscoveredProcessModels {
    const models: ProcessModel[] = [];
    const diagnostics: string[] = [];
    const seen = new Set<string>();

    for (const root of roots) {
        let skills: ReturnType<typeof discoverSkills>;
        try {
            skills = discoverSkills([root]);
        } catch (e) {
            // Con un solo root, discoverSkills no debería lanzar por colisión
            // (no hay con qué colisionar) — pero sí puede lanzar por I/O. Un
            // registry roto no debe impedir descubrir los demás (R7.1).
            diagnostics.push(`${root}: process model discovery unavailable (${e instanceof Error ? e.message : String(e)})`);
            continue;
        }

        for (const skill of skills) {
            const file = path.join(skill.path, 'SKILL.md');
            let source: string;
            try {
                source = fs.readFileSync(file, 'utf-8');
            } catch (e) {
                diagnostics.push(`${file}: cannot read (${e instanceof Error ? e.message : String(e)})`);
                continue;
            }

            const front = parseProcessFrontmatter(source, file);
            diagnostics.push(...front.diagnostics);
            if (!front.model) continue;                       // no es un modelo, o está roto

            const body = parseProcessBody(source, file);
            diagnostics.push(...body.diagnostics);
            if (!body.model) continue;

            if (seen.has(front.model.name)) {
                diagnostics.push(`${file}: process "${front.model.name}" duplicates one already declared by an earlier registry — shadowed duplicate dropped`);
                continue;
            }
            seen.add(front.model.name);
            models.push({ ...front.model, source: file, body: body.model });
        }
    }

    return { models, diagnostics };
}
