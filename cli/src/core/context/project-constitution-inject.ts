import fs from 'fs';
import path from 'path';
import { AgentTarget, PROVIDERS } from '../../providers';

export type ConstitutionInjectResult =
    | 'injected'        // se agregó la entrada
    | 'already'         // ya estaba (idempotente)
    | 'no-constitution' // no hay $PWD/CONSTITUTION.md
    | 'not-applicable'; // el agente no usa config-instructions (p.ej. Claude → hook)

/**
 * Entrega el `CONSTITUTION.md` del proyecto a agentes cuyo mecanismo de contexto es
 * `config-instructions` (hoy OpenCode), agregando una entrada relativa
 * `CONSTITUTION.md` al `instructions[]` de un `opencode.json` en la raíz del
 * proyecto (commiteable, viaja con el repo). Claude lo recibe vía el hook
 * SessionStart, así que para Claude es no-op. Agnóstico por construcción:
 * cualquier agente futuro con inyección `config-instructions` hereda el trato.
 */
export function injectProjectConstitution(projectRoot: string, agent: AgentTarget): ConstitutionInjectResult {
    const inj = PROVIDERS[agent].injection;
    if (!inj || inj.type !== 'config-instructions') return 'not-applicable';
    if (!fs.existsSync(path.join(projectRoot, 'CONSTITUTION.md'))) return 'no-constitution';

    const configPath = path.join(projectRoot, path.basename(inj.configPath)); // p.ej. 'opencode.json'
    const field = inj.field; // 'instructions'
    const REF = 'CONSTITUTION.md';

    let cfg: Record<string, unknown> = { $schema: 'https://opencode.ai/config.json' };
    if (fs.existsSync(configPath)) {
        try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')); }
        catch { throw new Error(`${configPath} is not valid JSON. Fix it manually, then re-run.`); }
    }

    const current = cfg[field];
    if (current !== undefined && !Array.isArray(current)) {
        throw new Error(`${configPath}: '${field}' field must be an array. Fix it manually, then re-run.`);
    }
    const list: string[] = Array.isArray(current) ? current : [];
    if (list.includes(REF)) return 'already';

    list.push(REF);
    cfg[field] = list;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    return 'injected';
}
