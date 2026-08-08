// Regresion: el ESCRITOR estampa la extension del renderer sobre el nombre
// (`using-awm.mdc`, `using-awm.instructions.md`, `development-process.toml`)
// pero los LECTORES de diagnostico buscaban el nombre pelado. Consecuencia para
// Cursor y Copilot: nada figuraba jamas como instalado, asi que
//   - `awm init` NUNCA era idempotente — reinstalaba el baseline entero en cada
//     corrida, dejando 2 directorios de backup sin podar por corrida;
//   - `awm doctor` mostraba `✖ dev-core` / `✖ active bundles` de forma
//     permanente, con un remedio (`awm init` / `awm sync`) que no podia
//     satisfacerlo nunca.
// Y lo mismo para los artefactos `agent` de claude-code — el provider POR
// DEFECTO — porque su installName es `<n>.md` y el lector mapeaba solo el caso
// `.toml` de codex.
//
// Estos tests recorren la misma funcion que usa el escritor
// (`renderedFilename`), asi que lector y escritor no pueden volver a discrepar.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderedFilename } from '../../../src/core/renderers/registry';
import { physicalTarget } from '../../../src/core/install-planner';
import type { AgentTarget } from '../../../src/providers';

describe('renderedFilename: una sola fuente de verdad para el nombre en disco', () => {
    it.each([
        ['link deja el nombre tal cual', 'using-awm', 'link' as const, 'using-awm'],
        ['link conserva el .md del installName', 'development-process.md', 'link' as const, 'development-process.md'],
        ['cursor-mdc', 'using-awm', 'cursor-mdc' as const, 'using-awm.mdc'],
        ['cursor-mdc recorta el .md antes de estampar', 'using-awm.md', 'cursor-mdc' as const, 'using-awm.mdc'],
        ['copilot-instructions', 'using-awm', 'copilot-instructions' as const, 'using-awm.instructions.md'],
        ['codex-agent-toml', 'development-process.md', 'codex-agent-toml' as const, 'development-process.toml'],
    ])('%s', (_n, installName, renderer, expected) => {
        expect(renderedFilename(installName, renderer)).toBe(expected);
    });

    it('no usa path.parse().name — un nombre con puntos internos no se trunca', () => {
        // `path.parse('v1.2-migration').name` === 'v1', lo que perderia
        // `2-migration` y podria colisionar con otro skill llamado `v1`.
        expect(renderedFilename('v1.2-migration', 'cursor-mdc')).toBe('v1.2-migration.mdc');
    });
});

describe('el lector de diagnostico ve lo que el escritor dejo en disco', () => {
    let projectRoot: string;

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rendered-'));
    });
    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    // El invariante que importa: el nombre que el escritor produce y el que el
    // lector busca salen de la MISMA funcion. Se verifica sobre el destino real
    // que planifica `physicalTarget`, no sobre una reconstruccion a mano.
    it.each<[AgentTarget]>([
        ['cursor'], ['copilot'], ['claude-code'], ['codex'], ['opencode'], ['antigravity'],
    ])('%s: el basename del destino planificado coincide con renderedFilename', (agent) => {
        const { targetPath, renderer } = physicalTarget(
            { name: 'using-awm', type: 'skill', installName: 'using-awm', sourcePath: '/tmp/src' },
            agent,
            'local',
            projectRoot,
        );
        expect(path.basename(targetPath)).toBe(renderedFilename('using-awm', renderer));
    });

    it('cursor: el destino termina en .mdc (el lector que buscaba el nombre pelado nunca lo encontraba)', () => {
        const { targetPath } = physicalTarget(
            { name: 'using-awm', type: 'skill', installName: 'using-awm', sourcePath: '/tmp/src' },
            'cursor', 'local', projectRoot,
        );
        expect(path.basename(targetPath)).toBe('using-awm.mdc');
        expect(fs.existsSync(path.join(path.dirname(targetPath), 'using-awm'))).toBe(false);
    });

    it('copilot: el destino termina en .instructions.md', () => {
        const { targetPath } = physicalTarget(
            { name: 'using-awm', type: 'skill', installName: 'using-awm', sourcePath: '/tmp/src' },
            'copilot', 'local', projectRoot,
        );
        expect(path.basename(targetPath)).toBe('using-awm.instructions.md');
    });
});
