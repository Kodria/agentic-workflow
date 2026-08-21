// Guarda estructural: `docs/support-matrix.md` no puede desalinearse de
// `src/providers/index.ts`.
//
// La tabla escrita a mano ya mintio. Decia que Antigravity instalaba en
// `~/.agents/skills` y `.agents/skills`; el codigo dice `~/.gemini/antigravity/skills` y
// `.agent/skills` — singular — y ademas es el unico provider con `global_workflows`, cosa
// que la tabla ni mencionaba. Nadie lo noto porque nada obligaba a mirarlo: la tabla se
// escribio una vez, el codigo siguio cambiando, y el documento se cita en presentaciones y
// se planifica encima.
//
// Este test hace que ese desvio sea imposible de mergear. No verifica que la tabla sea
// "linda": verifica que sea LA MISMA que produce el codigo hoy.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
    BEGIN_MARKER, END_MARKER, DOC_PATH, homeRelative, renderProviderTables, spliceGenerated,
} from '../../scripts/support-matrix';
import {
    R3_PREPUBLICATION_FIXTURE_PURPOSE, R3_PREPUBLICATION_FIXTURE_RELATIVE_PATH,
    SENSOR_BEGIN_MARKER, SENSOR_END_MARKER, extractPublishedSupportMetadata, renderSensorSupportMatrix, spliceSensorSupportMatrix, verifyPublishedRegistryIdentity,
} from '../../scripts/sensor-support-matrix';

const SENSOR_FIXTURE_REGISTRY = path.join(__dirname, '..', 'fixtures', 'sensor-support-matrix', 'registry');
const CI_WORKFLOW_PATH = path.resolve(__dirname, '../../..', '.github', 'workflows', 'ci.yml');


describe('docs/support-matrix.md refleja el codigo', () => {
    it('documents the bounded, empirical sensor gate contract (R3-R7, R10)', () => {
        const root = path.resolve(__dirname, '../../..');
        const cliReference = fs.readFileSync(path.join(root, 'docs', 'cli-reference.md'), 'utf8');
        const configuration = fs.readFileSync(path.join(root, 'docs', 'configuration.md'), 'utf8');
        const acceptance = fs.readFileSync(path.join(root, 'docs', 'testing', 'core-acceptance.md'), 'utf8');
        const osMatrix = fs.readFileSync(path.join(root, 'docs', 'testing', 'os-matrix.md'), 'utf8');

        for (const expected of [
            '`execution.timeoutMs`', '`timeoutSource`', '`elapsedMs`',
            '`requestedScope`', '`effectiveScope`', '`files`', '`scopeReason`',
            '`project` → `pack` → `fallback`', '10,000 ms', '120,000 ms',
            '`pass`', '`fail`', '`not_certified`', '`skipped`',
            '`awm preflight --verify-sensors`', 'read-only', 'READY', 'not a health or certification claim',
        ]) expect(cliReference + configuration + acceptance).toContain(expected);

        expect(acceptance).toContain('legacy manifest');
        expect(acceptance).toContain('v2 manifest without new fields');
        expect(acceptance).toContain('supported, unsupported, empty, and Git-error');
        expect(acceptance).toContain('project, pack, and fallback');
        expect(osMatrix).toContain('Ubuntu, macOS, and native Windows');
        expect(osMatrix).toContain('shell-free');
    });

    it('el bloque generado esta al dia', () => {
        const doc = fs.readFileSync(DOC_PATH, 'utf-8');
        const expected = spliceGenerated(doc, renderProviderTables());

        // Mensaje accionable: el que rompe esto casi siempre acaba de tocar
        // providers/index.ts y no sabe que este documento existe.
        expect(doc).toBe(expected);
    });

    it('el documento conserva sus marcadores', () => {
        const doc = fs.readFileSync(DOC_PATH, 'utf-8');
        expect(doc).toContain(BEGIN_MARKER);
        expect(doc).toContain(END_MARKER);
    });

    it('keeps the generated pre-publication v2 fixture separately renderable', () => {
        const doc = fs.readFileSync(DOC_PATH, 'utf-8');
        const fixture = renderSensorSupportMatrix(SENSOR_FIXTURE_REGISTRY);
        expect(fixture).toContain(R3_PREPUBLICATION_FIXTURE_PURPOSE);
        expect(fixture).toContain('not the published `awm-baseline-registry` manifests');
        expect(fixture).not.toContain('Published certification evidence');
        expect(doc).toContain(SENSOR_BEGIN_MARKER);
        expect(doc).toContain(SENSOR_END_MARKER);
        expect(doc).toContain('published registry evidence');
        expect(doc).toContain('Published certification evidence');
    });

    it('uses a published registry root for documentation and retains a fixture-only command', () => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
            scripts?: { ['docs:matrix']?: unknown; ['docs:matrix:prepublication']?: unknown };
        };
        expect(packageJson.scripts?.['docs:matrix']).toContain('--registry-root ../../awm-baseline-registry');
        expect(packageJson.scripts?.['docs:matrix:prepublication']).toContain(`--registry-root ${R3_PREPUBLICATION_FIXTURE_RELATIVE_PATH}`);
    });

    it('CI regenerates the published matrix from the immutable registry tag', () => {
        const workflow = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');

        expect(workflow).toContain('repository: Kodria/awm-baseline-registry');
        expect(workflow).toContain('ref: v2.0.1');
        expect(workflow).toContain('path: awm-baseline-registry');
        expect(workflow).toContain('Verify published sensor support matrix');
        expect(workflow).toContain('--registry-root ../awm-baseline-registry --registry-tag v2.0.1 --registry-commit 6f40632006fc65300ac633c5a54f2635cf0eb8e9');
        expect(workflow).toContain('git diff --exit-code -- docs/support-matrix.md');
    });

    it('retains the published registry certification rows verbatim instead of inventing fixture evidence', () => {
        const publishedSupport = [
            '# Sensor pack support',
            '',
            '<!-- BEGIN GENERATED: sensor-pack-support -->',
            'Generated from pack manifests and certification pins resolved at `2026-08-14T22:14:34.365Z`.',
            '',
            'Status: `certified` has a matching frozen tool pin; `compatible-unverified` has no matching frozen pin; `not-applicable` is reserved for variants without a tool contract.',
            '',
            '| Pack | Sensor | Variant | Tool | Certified range | Supported OS | OS certification evidence | Status | Evidence |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
            '| `js-ts` | `lint` | `eslint-10-flat` | `eslint` | `=10.8.1` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | certified | pin: `eslint@10.8.1` |',
            '| `js-ts` | `test` | `npm-script` | `npm` | `>=8.0.0` | Ubuntu, macOS, Windows | Ubuntu/macOS/Windows: contract | compatible-unverified | no matching pinned tool |',
            '',
            '| Certification status | Derived variant count | Meaning |',
            '| --- | --- | --- |',
            '| certified | 15 | Matching frozen tool pin |',
            '| compatible-unverified | 6 | No matching frozen tool pin |',
            '| not-applicable | 0 | Variant has no tool contract |',
            '<!-- END GENERATED: sensor-pack-support -->',
            '',
        ].join('\n');

        expect(extractPublishedSupportMetadata(publishedSupport)).toContain('`eslint-10-flat`');
        expect(extractPublishedSupportMetadata(publishedSupport)).toContain('compatible-unverified');
        expect(extractPublishedSupportMetadata(publishedSupport)).not.toContain('Fixture-declared ranges only');
    });

    it('rejects a mutable checkout even when it contains the published v2.0.1 tag', () => {
        const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-published-registry-'));
        const git = (...args: string[]) => execFileSync('git', ['-C', registryRoot, ...args], { stdio: 'pipe' });
        try {
            git('init');
            git('config', 'user.email', 'test@example.com');
            git('config', 'user.name', 'AWM test');
            fs.writeFileSync(path.join(registryRoot, 'published.txt'), 'published\n');
            git('add', '.');
            git('commit', '-m', 'published registry');
            git('tag', 'v2.0.1');
            fs.writeFileSync(path.join(registryRoot, 'mutable.txt'), 'newer checkout\n');
            git('add', '.');
            git('commit', '-m', 'mutable checkout');

            expect(() => verifyPublishedRegistryIdentity(registryRoot, 'v2.0.1', '6f40632006fc65300ac633c5a54f2635cf0eb8e9')).toThrow(/HEAD .*expected commit/i);
        } finally {
            fs.rmSync(registryRoot, { recursive: true, force: true });
        }
    });

    it('la tabla nombra a los seis providers declarados', () => {
        // Que el bloque este "al dia" no sirve si el generador se olvidara de un provider:
        // doc y generador coincidirian, los dos incompletos.
        const { AGENT_TARGETS } = require('../../src/providers');
        const generated = renderProviderTables();
        for (const agent of AGENT_TARGETS) {
            expect(generated).toContain(`\`${agent}\``);
        }
    });

    it('abrevia el home y usa separadores POSIX, para no depender de la maquina', () => {
        // Con un HOME inventado: si la tabla dependiera de la maquina que la genera, este
        // home apareceria literal en la salida y el doc comiteado cambiaria segun quien
        // corriera el generador — el test de arriba se volveria ruido permanente.
        const saved = process.env.HOME;
        process.env.HOME = '/home/inventado';
        try {
            jest.resetModules();
            const { renderProviderTables: fresh } = require('../../scripts/support-matrix');
            const generated: string = fresh();
            expect(generated).toContain('`~/.claude/skills`');
            expect(generated).not.toContain('/home/inventado');
            expect(generated).not.toContain('\\');
        } finally {
            if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
            jest.resetModules();
        }
    });

    it('documents default provider paths even when this machine overrides CODEX_HOME', () => {
        const saved = process.env.CODEX_HOME;
        process.env.CODEX_HOME = '/private/codex-home';
        try {
            jest.resetModules();
            const { renderProviderTables: fresh } = require('../../scripts/support-matrix');
            expect(fresh()).toContain('`~/.codex/agents`');
            expect(fresh()).not.toContain('/private/codex-home');
        } finally {
            if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
            jest.resetModules();
        }
    });

    it('does not leak a normalized CODEX_HOME override into generated documentation', () => {
        const saved = process.env.CODEX_HOME;
        process.env.CODEX_HOME = '/private/codex/../secret-codex/';
        try {
            jest.resetModules();
            const { renderProviderTables: fresh } = require('../../scripts/support-matrix');
            const generated: string = fresh();
            expect(generated).toContain('`~/.codex/agents`');
            expect(generated).not.toContain('/private/');
            expect(generated).not.toContain('secret-codex');
        } finally {
            if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
            jest.resetModules();
        }
    });

    it('keeps a separator when CODEX_HOME has a trailing slash', () => {
        const saved = process.env.CODEX_HOME;
        process.env.CODEX_HOME = '/private/codex-home/';
        try {
            jest.resetModules();
            const { renderProviderTables: fresh } = require('../../scripts/support-matrix');
            expect(fresh()).toContain('`~/.codex/agents`');
        } finally {
            if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
            jest.resetModules();
        }
    });

    // La abreviacion a `~` se probaba solo end-to-end, y en Linux eso no distingue entre
    // "normaliza bien" y "los separadores ya coincidian". La CI de Windows encontro que no
    // normalizaba: comparaba el prefijo ANTES de convertir separadores, asi que alla no
    // abreviaba nada y la tabla regenerada no era la comiteada. Probar la unidad con las
    // dos formas de ruta lo detecta en cualquier sistema, sin fingir la plataforma.
    describe('homeRelative normaliza antes de comparar', () => {
        it.each([
            ['posix',      '/home/x',        '/home/x/.claude/skills',            '~/.claude/skills'],
            ['win32',      'C:\\Users\\x',    'C:\\Users\\x\\.claude\\skills',     '~/.claude/skills'],
            ['mixto',      '/home/x',        '\\home\\x\\.claude\\skills',         '~/.claude/skills'],
            ['sin prefijo', '/home/x',       '/opt/otro/skills',                  '/opt/otro/skills'],
        ])('%s', (_n, home, input, expected) => {
            expect(homeRelative(input, home)).toBe(expected);
        });

        it('nunca deja un separador de Windows en la salida', () => {
            expect(homeRelative('C:\\Users\\x\\.codex\\agents', 'C:\\Users\\x')).not.toContain('\\');
        });
    });

    it('respeta el fin de linea del documento (un checkout de Windows entrega CRLF)', () => {
        // Sin esto, regenerar en Windows dejaba el archivo con finales mezclados y el test
        // de arriba fallaba por bytes ajenos al contenido. Es el mismo error de fondo que
        // el de los separadores: asumir la forma de POSIX para un dato que la plataforma
        // decide.
        const crlfDoc = `intro\r\n${BEGIN_MARKER}\r\nviejo\r\n${END_MARKER}\r\nfin\r\n`;
        const out = spliceGenerated(crlfDoc, 'linea uno\nlinea dos');

        expect(out).toContain('linea uno\r\nlinea dos');
        expect(out.split('\r\n').length - 1).toBe(out.split('\n').length - 1); // ni un LF suelto
    });

    it('preserva el EOL del bloque de providers aunque otro bloque sea CRLF', () => {
        const mixedDoc = `intro\r\n${BEGIN_MARKER}\nold\n${END_MARKER}\nfin\n`;
        const out = spliceGenerated(mixedDoc, 'linea uno\nlinea dos');

        expect(out).toContain(`${BEGIN_MARKER}\n\nlinea uno\nlinea dos\n\n${END_MARKER}`);
    });

    it('preserva el EOL del bloque de sensores aunque otro bloque sea CRLF', () => {
        const mixedDoc = `intro\r\n${SENSOR_BEGIN_MARKER}\nold\n${SENSOR_END_MARKER}\nfin\n`;
        const out = spliceSensorSupportMatrix(mixedDoc, 'linea uno\nlinea dos');

        expect(out).toContain(`${SENSOR_BEGIN_MARKER}\n\nlinea uno\nlinea dos\n\n${SENSOR_END_MARKER}`);
    });

    it('marks an unsupported scope rather than leaving it absent', () => {
        // La diferencia entre "no soportado" y una celda vacia es exactamente lo que el
        // documento existe para no dejar ambiguo: Copilot no tiene scope global por
        // decision del producto que integramos, no porque falte implementarlo.
        const generated = renderProviderTables();
        const copilotRow = generated.split('\n').find((l) => l.startsWith('| `copilot` |'))!;
        expect(copilotRow).toContain('**unsupported**');
    });
});
