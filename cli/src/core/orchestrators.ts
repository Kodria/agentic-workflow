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
import { REGISTRY_MANIFEST_NAME, assertRegularRegistryFile } from './registries';

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
