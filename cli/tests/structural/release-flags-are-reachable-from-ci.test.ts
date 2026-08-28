// Guard estructural — una capacidad del release que CI no puede invocar no existe en la
// práctica, y su ausencia no se nota hasta el día que hace falta.
//
// Pasó con `--force`. El flag estaba implementado y cubierto por tests
// (tests/release/orchestrator.test.ts: "--force patch publica aunque no haya commits
// releasables"), pero `release.yml` solo pasaba `--dry-run`. Consecuencia real: el PR #88
// corrigió `"license": "ISC"` -> `"Apache-2.0"` en el paquete publicado, se mergeó como
// `chore(legal):`, `determineBump` devolvió null — correctamente, un chore no es un
// release —, el workflow corrió EN VERDE y no publicó nada. `main` quedó bien y npm
// siguió entregando la licencia equivocada. No había forma de publicarlo desde CI.
//
// La regla no enumera los flags a mano: los deriva del propio `parseArgs`, así que un
// flag agregado mañana obliga a decidir explícitamente si CI puede alcanzarlo, en vez de
// heredar el silencio.
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');
const RELEASE_ENTRY = path.join(CLI_ROOT, 'src', 'release', 'index.ts');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

// Flags deliberadamente NO expuestos a CI, con la razón por la que no lo están. Sacar uno
// de acá sin exponerlo en el workflow rompe el test a propósito.
const NOT_FOR_CI: Record<string, string> = {
    '--no-push': 'uso local: un release desde CI siempre empuja',
    '--branch': 'CI siempre libera desde main; el gate de rama vive en el orquestador',
};

/** Los flags que `parseArgs` realmente acepta, leídos del código, no de una lista. */
function acceptedFlags(): string[] {
    const source = fs.readFileSync(RELEASE_ENTRY, 'utf8');
    const found = [...source.matchAll(/a === '(--[a-z-]+)'/g)].map((m) => m[1]);
    return [...new Set(found)];
}

/** El workflow sin sus comentarios. La alcanzabilidad se mide sobre lo que EJECUTA: un
 *  comentario que menciona `--force` no lo hace invocable, y la primera versión de este
 *  test se dejaba engañar por exactamente eso. */
function withoutComments(source: string): string {
    return source
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
}

describe('flags del release: implementados <=> alcanzables desde CI', () => {
    const workflowSource = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');
    const executable = withoutComments(workflowSource);
    const workflow = yaml.load(workflowSource) as {
        on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
    };

    it('parseArgs declara al menos un flag', () => {
        expect(acceptedFlags().length).toBeGreaterThan(0);
    });

    it('cada flag del release está expuesto en release.yml o excluido con motivo', () => {
        const unreachable = acceptedFlags().filter(
            (flag) => !executable.includes(flag) && !(flag in NOT_FOR_CI),
        );
        expect(unreachable).toEqual([]);
    });

    it('workflow_dispatch expone el bump forzado', () => {
        const inputs = workflow.on?.workflow_dispatch?.inputs ?? {};
        expect(Object.keys(inputs)).toContain('bump');
    });

    it('el paso de Release pasa --force solo cuando el bump no es auto', () => {
        expect(workflowSource).toMatch(/inputs\.bump != 'auto'/);
        expect(workflowSource).toMatch(/--force \{0\}/);
    });
});

describe('matriz de compilacion nativa Windows', () => {
    for (const workflowPath of [CI_WORKFLOW, RELEASE_WORKFLOW]) {
        it(`${path.basename(workflowPath)} fija x64 en Windows Server 2022 y conserva ARM64 nativo`, () => {
            const source = fs.readFileSync(workflowPath, 'utf8');
            expect(source).toMatch(/- os: windows-2022\s+target: win32-x64/);
            expect(source).toMatch(/- os: windows-11-arm\s+target: win32-arm64/);
        });
    }
});
