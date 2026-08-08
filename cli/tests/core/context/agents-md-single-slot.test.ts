// Regresion: `managed-block.ts` soporta UN bloque gestionado por archivo, y
// tanto el contexto de cursor/copilot (`inject()`, cuyo destino ES el AGENTS.md
// del proyecto) como la guia de proyecto de codex (`injectProject()`) apuntan al
// mismo `<projectRoot>/AGENTS.md`. El que corriera ultimo ganaba:
//
//     awm init -a copilot  → AGENTS.md 140 lineas (contexto AWM completo)
//     awm init -a codex    → AGENTS.md   6 lineas (solo PROJECT_GUIDANCE)
//     awm init -a copilot  → 140 otra vez ... y asi oscilando
//
// Para Copilot ese archivo es su UNICO canal de entrega, asi que un init de
// codex lo dejaba literalmente sin contexto. El contenido de cursor/copilot es
// un SUPERCONJUNTO — termina con el mismo PROJECT_GUIDANCE — asi que pisarlo
// siempre es perder informacion.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodexAgentsStrategy } from '../../../src/core/context/strategies/codex-agents';
import { managedBlockBody } from '../../../src/core/context/managed-block';
import { providerFor } from '../../../src/providers';

describe('AGENTS.md: un solo slot, dos escritores', () => {
    let projectRoot: string;
    let agentsMd: string;

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-agentsmd-'));
        agentsMd = path.join(projectRoot, 'AGENTS.md');
    });
    afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    const strategy = () => new CodexAgentsStrategy();

    it('injectProject de codex NO pisa un bloque que ya cubre PROJECT_GUIDANCE', () => {
        // Primero se deja que codex escriba, para capturar su PROJECT_GUIDANCE
        // sin depender de un export interno.
        strategy().injectProject(projectRoot, providerFor('codex'), 'codex');
        const guidance = managedBlockBody(fs.readFileSync(agentsMd, 'utf-8'))!;

        // Ahora se simula lo que dejan cursor/copilot: contexto AWM completo
        // que TERMINA con esa misma guia — un superconjunto.
        const rich = `# Contexto AWM completo\n\nmuchas lineas de contexto\n\n${guidance}`;
        fs.writeFileSync(agentsMd, `<!-- AWM:START -->\n${rich}\n<!-- AWM:END -->\n`);
        const before = fs.readFileSync(agentsMd, 'utf-8');

        // Un `awm init -a codex` posterior debe dejarlo intacto: antes lo
        // reemplazaba por las 6 lineas de la guia, y para Copilot ese archivo es
        // su unico canal de entrega.
        strategy().injectProject(projectRoot, providerFor('codex'), 'codex');

        expect(fs.readFileSync(agentsMd, 'utf-8')).toBe(before);
        expect(fs.readFileSync(agentsMd, 'utf-8')).toContain('muchas lineas de contexto');
    });


    it('codex SI escribe la guia cuando el archivo no existe todavia', () => {
        strategy().injectProject(projectRoot, providerFor('codex'), 'codex');
        expect(fs.existsSync(agentsMd)).toBe(true);
        expect(managedBlockBody(fs.readFileSync(agentsMd, 'utf-8'))).toBeTruthy();
    });

    it('codex es idempotente: una segunda pasada no cambia el archivo', () => {
        strategy().injectProject(projectRoot, providerFor('codex'), 'codex');
        const first = fs.readFileSync(agentsMd, 'utf-8');
        strategy().injectProject(projectRoot, providerFor('codex'), 'codex');
        expect(fs.readFileSync(agentsMd, 'utf-8')).toBe(first);
    });

    it('el contenido que el usuario tiene fuera del bloque gestionado se conserva', () => {
        fs.writeFileSync(agentsMd, '# Mis notas\n\nEsto es mio.\n');
        strategy().injectProject(projectRoot, providerFor('codex'), 'codex');
        const after = fs.readFileSync(agentsMd, 'utf-8');
        expect(after).toContain('# Mis notas');
        expect(after).toContain('Esto es mio.');
    });
});
