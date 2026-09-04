// cli/src/core/orchestrators.ts
// Lector de declaraciones de orquestador. A diferencia de readRegistryManifest
// (registries.ts), este parser NUNCA lanza: una declaracion malformada se
// rechaza y se reporta, sin invalidar el registry que la contiene ni a los
// demas (R1.2). El contrato admite exactamente cuatro campos — identidad,
// cuando aplica, y a quien cede el control — y rechaza cualquier otro, que
// es como se impide que vocabulario de un proceso concreto (o un secreto)
// entre al framework (R1.3, R5.3).
import fs from 'fs';
import path from 'path';
import { REGISTRY_MANIFEST_NAME, assertRegularRegistryFile, contentRoots, listRegistries } from './registries';
import { discoverSkills } from './discovery';
import { sanitizeDeclaredField, stripControlChars } from './text';

export interface DeclaredOrchestrator {
    name: string;
    appliesWhen: string;
    terminatesTo: string;
}

export interface DeclaredOrchestratorsResult {
    orchestrators: DeclaredOrchestrator[];
    diagnostics: string[];
}

const ALLOWED_FIELDS = ['name', 'appliesWhen', 'terminatesTo'] as const;

// These fields are semantically short (a short identity, a short trigger condition, a
// short target name) — no legitimate declaration needs more than this. A registry is
// untrusted input whose fields flow straight into the AI-provider context payload, so an
// unbounded string here would let a crafted registry bloat/DoS that context.
const MAX_FIELD_LENGTH = 500;

function discoverDeclaredSkillNames(): { names: Set<string>; diagnostics: string[] } {
    const names = new Set<string>();
    const diagnostics: string[] = [];

    for (const root of contentRoots()) {
        try {
            for (const skill of discoverSkills([root])) names.add(skill.name);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            diagnostics.push(`${stripControlChars(root)}: orchestrator skill discovery unavailable (${stripControlChars(message)})`);
        }
    }

    return { names, diagnostics };
}

export function readDeclaredOrchestrators(root: string): DeclaredOrchestratorsResult {
    const file = path.join(root, REGISTRY_MANIFEST_NAME);

    // Shares the same trust boundary as readRegistryManifest (registries.ts): a manifest
    // that is a symlink (or otherwise not a regular file) is rejected rather than followed.
    // assertRegularRegistryFile throws on that case, so it's wrapped locally — this reader
    // must never throw, only report (R1.2).
    let exists: boolean;
    try {
        exists = assertRegularRegistryFile(file);
    } catch (e) {
        return { orchestrators: [], diagnostics: [`${file}: ${e instanceof Error ? e.message : String(e)}`] };
    }
    if (!exists) return { orchestrators: [], diagnostics: [] };

    let contents: string;
    try {
        contents = fs.readFileSync(file, 'utf-8');
    } catch (e) {
        return { orchestrators: [], diagnostics: [`${file}: cannot read manifest (${e instanceof Error ? e.message : String(e)})`] };
    }

    let raw: unknown;
    try {
        raw = JSON.parse(contents);
    } catch (e) {
        return { orchestrators: [], diagnostics: [`${file}: manifest is not valid JSON (${e instanceof Error ? e.message : String(e)})`] };
    }

    const decl = (raw as Record<string, unknown>)?.orchestrator;
    if (decl === undefined) return { orchestrators: [], diagnostics: [] };

    if (typeof decl !== 'object' || decl === null || Array.isArray(decl)) {
        return { orchestrators: [], diagnostics: [`${file}: "orchestrator" must be an object`] };
    }

    const problems: string[] = [];
    const entries = decl as Record<string, unknown>;

    for (const key of Object.keys(entries)) {
        if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
            // key comes straight from an untrusted registry's JSON — JSON.stringify keeps the
            // diagnostic single-line and unambiguous even if the key contains newlines or other
            // control characters, which would otherwise let a crafted key forge extra log lines.
            problems.push(`unknown field ${JSON.stringify(key)} — the contract admits only ${ALLOWED_FIELDS.join(', ')}`);
        }
    }
    for (const field of ALLOWED_FIELDS) {
        const value = entries[field];
        if (typeof value !== 'string' || value.trim() === '') {
            problems.push(`"${field}" must be a non-empty string`);
        } else if (value.length > MAX_FIELD_LENGTH) {
            problems.push(`"${field}" must be at most ${MAX_FIELD_LENGTH} characters`);
        }
    }

    if (problems.length > 0) {
        return { orchestrators: [], diagnostics: [`${file}: invalid "orchestrator" declaration — ${problems.join('; ')}`] };
    }

    return {
        orchestrators: [{
            name: entries.name as string,
            appliesWhen: entries.appliesWhen as string,
            terminatesTo: entries.terminatesTo as string,
        }],
        diagnostics: [],
    };
}

/**
 * Recolecta declaraciones de orquestador de TODOS los registries instalados (no solo
 * el que se esta operando) y diagnosticos de las que estan rotas. Nunca lanza:
 * `readDeclaredOrchestrators` ya garantiza eso por-registry (R1.2), asi que un registry
 * con declaracion rota se omite del resultado sin impedir construir el contexto (R5.1).
 *
 * Vive aca (no en core/context/orchestrator.ts, que la definia originalmente) porque
 * este modulo es una hoja: solo depende de `./registries`, que a su vez no depende de
 * nada bajo commands/*. core/context/orchestrator.ts en cambio arrastra
 * strategies/hook-merge.ts, que importa commands/hooks/install.ts — y claude.ts
 * necesita esta funcion para cerrar el bypass del SKILL.md crudo (Task 6). Si
 * `collectAndWarn` siguiera viviendo en orchestrator.ts, que commands/hooks/claude.ts
 * la importara cerraria un ciclo real: claude.ts -> orchestrator.ts ->
 * strategies/hook-merge.ts -> commands/hooks/install.ts -> claude.ts.
 *
 * Dedupe por "name" entre registries: dos registries instalados pueden declarar el mismo
 * nombre (posiblemente con appliesWhen/terminatesTo distintos y contradictorios). En vez
 * de emitir ambas filas al markdown compuesto, gana la primera en el orden de
 * listRegistries() (= orden de registries.json, ver registries.ts) y la duplicada se
 * descarta con un diagnostico — misma degradacion tolerante (reportar, no lanzar) que el
 * resto de este modulo (R1.2, R5.1). `orch.name` es contenido no confiable del registry:
 * se pasa por `stripControlChars` (core/text.ts) antes de interpolarlo en el diagnostico,
 * que termina crudo en stderr real via `command-result.ts`'s `diagnosticsToStderr`/`emit`.
 *
 * Ademas del dedupe por nombre CRUDO, dos orquestadores con nombres crudos distintos
 * (p.ej. `foo_bar` y `foo*bar`) pueden colisionar DESPUES del saneo que aplica
 * `composedOrchestrators` (core/context/provider.ts) — ambos renderizarian como el mismo
 * `foobar` visible, sin explicacion. Como son declaraciones genuinamente distintas, no se
 * descarta ninguna (eso perderia una declaracion real) — se emite un diagnostico
 * accionable en su lugar. `sanitizeDeclaredField` vive en core/text.ts (no en provider.ts)
 * precisamente para que este modulo -- que debe seguir siendo hoja y no puede importar
 * context/provider.ts, el cual ya importa `DeclaredOrchestrator` DESDE este archivo -- pueda
 * calcular el mismo nombre saneado sin duplicar el regex.
 */
export function collectDeclaredOrchestrators(): { declared: DeclaredOrchestrator[]; diagnostics: string[] } {
    const declared: DeclaredOrchestrator[] = [];
    const { names: availableSkillNames, diagnostics } = discoverDeclaredSkillNames();
    const seenNames = new Set<string>();
    const seenSanitizedNames = new Set<string>();
    for (const reg of listRegistries()) {
        const r = readDeclaredOrchestrators(reg.contentRoot);
        for (const orch of r.orchestrators) {
            const file = path.join(reg.contentRoot, REGISTRY_MANIFEST_NAME);
            if (!availableSkillNames.has(orch.name)) {
                diagnostics.push(`${stripControlChars(file)}: orchestrator declaration dropped because skill "${stripControlChars(orch.name)}" is not discoverable in configured safe registries`);
                continue;
            }
            if (seenNames.has(orch.name)) {
                diagnostics.push(`${file}: orchestrator "${stripControlChars(orch.name)}" duplicates one already declared by an earlier registry — shadowed duplicate dropped`);
                continue;
            }
            seenNames.add(orch.name);

            const sanitizedName = sanitizeDeclaredField(orch.name);
            if (seenSanitizedNames.has(sanitizedName)) {
                diagnostics.push(`${file}: orchestrator "${stripControlChars(orch.name)}" sanitizes to the same composed name "${sanitizedName}" as an already declared orchestrator — both will render as indistinguishable duplicates in the composed context`);
            } else {
                seenSanitizedNames.add(sanitizedName);
            }
            declared.push(orch);
        }
        diagnostics.push(...r.diagnostics);
    }
    return { declared, diagnostics };
}

/** Recolecta declarados y emite sus diagnosticos como warnings. Punto unico usado por
 *  `InjectionOrchestrator.inputFor`/`statusInputFor` y por `commands/hooks/claude.ts`
 *  para que todos permanezcan sincronizados por construccion (ver R5.1 y el bug de
 *  staleness que motivo esta extraccion). */
export function collectAndWarn(): DeclaredOrchestrator[] {
    const { declared, diagnostics } = collectDeclaredOrchestrators();
    for (const d of diagnostics) console.warn(`warning: ${d}`);
    return declared;
}
