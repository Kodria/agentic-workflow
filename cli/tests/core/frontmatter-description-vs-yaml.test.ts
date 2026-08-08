// Test DIFERENCIAL: readFrontmatterDescription (parser a mano, cero deps de
// runtime) contra js-yaml (parser YAML real, devDependency solo de test).
//
// Por que existe: el repo parsea el frontmatter a mano a proposito (ver
// core/export/transform.ts — "sin parser YAML a proposito, YAGNI, cero deps").
// Esa decision es sostenible SOLO si algo verifica que la implementacion a
// mano coincide con la semantica YAML real; si no, cada forma valida que el
// parser casero no contempla es un bug esperando a un skill que la use. Ya
// paso dos veces: (1) un block scalar (`description: >-`) se colapsaba a
// vacio, rompiendo `awm add -a cursor|copilot` y abortando `awm export`
// entero contra un skill real del registry; (2) este mismo test diferencial
// descubrio que un escalar single-quoted no deshacia el escape YAML de `'`
// (duplicado: `''`), devolviendo "it''s" en vez de "it's".
//
// js-yaml es devDependency: NO entra en el bundle que instalan los usuarios.
// La regla de cero dependencias de runtime queda intacta — de hecho este test
// es lo que la hace defendible.
import yaml from 'js-yaml';
import { readFrontmatterDescription } from '../../src/core/discovery';

/** Cada caso es un bloque de frontmatter cuyo `description` debe resolverse
 *  IGUAL que como lo hace un parser YAML real. Sin valores esperados
 *  hardcodeados a proposito: la referencia es js-yaml, asi que el test no
 *  puede "envejecer" hacia una expectativa equivocada. */
const CASES: Array<[name: string, frontmatter: string]> = [
    ['folded (>)', 'description: >\n  a\n  b'],
    ['folded strip (>-)', 'description: >-\n  a\n  b'],
    ['folded keep (>+)', 'description: >+\n  a\n  b'],
    ['literal (|)', 'description: |\n  a\n  b'],
    ['literal strip (|-)', 'description: |-\n  a\n  b'],
    ['folded con parrafos', 'description: >-\n  a\n\n  b'],
    ['literal con parrafos', 'description: |-\n  a\n\n  b'],
    ['bloque seguido de otra clave', 'description: >-\n  solo\nname: x'],
    ['bloque con indent 4', 'description: >-\n    a\n    b'],
    ['bloque con indent explicito', 'description: >2\n  a\n  b'],
    ['bloque de una sola linea', 'description: >-\n  sola'],
    ['bloque con colon adentro', 'description: >-\n  clave: valor'],
    ['bloque con hash adentro', 'description: >-\n  a #no-es-comentario'],
    ['plain', 'description: hola mundo'],
    ['plain con guion', 'description: usa - guiones'],
    ['double-quoted con colon', 'description: "hola: mundo"'],
    ['double-quoted con comilla escapada', 'description: "dice \\"hola\\""'],
    ['double-quoted con \\n', 'description: "a\\nb"'],
    ['double-quoted con backslash', 'description: "c:\\\\\\\\ruta"'],
    ['single-quoted con apostrofe escapado', "description: 'it''s aqui'"],
    ['single-quoted con doble apostrofe', "description: 'a''''b'"],
    ['single-quoted con colon', "description: 'clave: valor'"],
    ['double-quoted con em-dash', 'description: "em — dash"'],
    // Casos que una revision adversarial encontro y los tests a mano no cubrian.
    ['folded con lineas MAS indentadas (no se pliegan)', 'description: >-\n  intro\n    - item uno\n    - item dos\n  outro'],
    ['folded con indentacion irregular', 'description: >\n  foo\n   bar\n  baz'],
    ['indicador con comentario final', 'description: >- # nota al margen\n  el texto real'],
    ['literal con comentario final', 'description: |- # nota\n  linea'],
    ['clave description indentada NO gana sobre la real', 'metadata:\n  description: nota interna\ndescription: la verdadera'],
    ['description dentro del contenido de otro bloque', 'example: |\n  description: falsa\ndescription: la verdadera'],
    ['plain con comentario final', 'description: hola mundo # un comentario'],
    ['plain con hash pegado (NO es comentario)', 'description: usar C# y F#'],
    ['plain multilinea (se pliega como folded)', 'description: primera\n  segunda\n  tercera'],
    ['quoted con hash adentro (literal)', 'description: "tiene # adentro"'],
];

describe('readFrontmatterDescription coincide con un parser YAML real (js-yaml)', () => {
    it.each(CASES)('%s', (_name, frontmatter) => {
        const parsed = yaml.load(frontmatter) as { description?: unknown };
        // Guard del propio fixture: si js-yaml no lo lee como string, el caso
        // esta mal escrito y el test seria vacuo — que falle fuerte.
        expect(typeof parsed.description).toBe('string');
        const expected = (parsed.description as string).trim();
        expect(readFrontmatterDescription(frontmatter)).toBe(expected);
    });

    it('resuelve el SKILL.md real del registry igual que js-yaml (extract-design-md, el caso que origino el bug)', () => {
        // Forma exacta del skill real de awm-baseline-registry que rompia
        // `awm add -a cursor|copilot` y `awm export frontend`.
        const frontmatter = [
            'name: extract-design-md',
            'version: "1.0.1"',
            'description: >-',
            '  Extract a comprehensive design system (DESIGN.md) directly from frontend source',
            '  code — React, Vue, Svelte, Angular, plain HTML/CSS, or any web framework.',
            'allowed-tools:',
            '  - "Bash"',
        ].join('\n');
        const expected = ((yaml.load(frontmatter) as { description: string }).description).trim();
        expect(readFrontmatterDescription(frontmatter)).toBe(expected);
        // Y no absorbio la clave siguiente ni sus items indentados.
        expect(readFrontmatterDescription(frontmatter)).not.toContain('allowed-tools');
        expect(readFrontmatterDescription(frontmatter)).not.toContain('Bash');
    });
});
