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
import path from 'path';
import {
    BEGIN_MARKER, END_MARKER, DOC_PATH, homeRelative, renderProviderTables, spliceGenerated,
} from '../../scripts/support-matrix';
import {
    SENSOR_BEGIN_MARKER, SENSOR_END_MARKER, renderSensorSupportMatrix, spliceSensorSupportMatrix,
} from '../../scripts/sensor-support-matrix';

const SENSOR_FIXTURE_REGISTRY = path.join(__dirname, '..', 'fixtures', 'sensor-support-matrix', 'registry');


describe('docs/support-matrix.md refleja el codigo', () => {
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

    it('the generated v2 sensor-pack block is current', () => {
        const doc = fs.readFileSync(DOC_PATH, 'utf-8');
        expect(doc).toContain(SENSOR_BEGIN_MARKER);
        expect(doc).toContain(SENSOR_END_MARKER);
        expect(doc).toBe(spliceSensorSupportMatrix(doc, renderSensorSupportMatrix(SENSOR_FIXTURE_REGISTRY)));
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

    it('marks an unsupported scope rather than leaving it absent', () => {
        // La diferencia entre "no soportado" y una celda vacia es exactamente lo que el
        // documento existe para no dejar ambiguo: Copilot no tiene scope global por
        // decision del producto que integramos, no porque falte implementarlo.
        const generated = renderProviderTables();
        const copilotRow = generated.split('\n').find((l) => l.startsWith('| `copilot` |'))!;
        expect(copilotRow).toContain('**unsupported**');
    });
});
