import yaml from 'js-yaml';
import { claudeAiTransform, DEFERENCE_LINE, stripIntraRegistryPaths } from '../../../src/core/export/transform';

const FM = (lines: string[]) => `---\n${lines.join('\n')}\n---\nBody line.\n`;

/** Reparsea el frontmatter EXPORTADO con un YAML real y devuelve su
 *  `description`. Lanza si la salida no es YAML valido — que es justamente lo
 *  que queremos que falle fuerte, en vez de asertar sobre el texto crudo y no
 *  enterarnos de que emitimos algo que ningun parser puede leer. */
function descriptionOf(exported: string): string {
    const fm = exported.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) throw new Error('la salida no tiene bloque de frontmatter');
    const parsed = yaml.load(fm[1]) as { description?: unknown };
    if (typeof parsed.description !== 'string') throw new Error('description ausente o no-string en la salida');
    return parsed.description;
}

describe('claudeAiTransform', () => {
  it('strips version and portable, keeps other keys and body intact', () => {  // verifies R3.1
    const input = FM(['name: mermaid-diagrams', 'version: "1.0.0"', 'portable: true', 'description: "Guide."']);
    const out = claudeAiTransform(input, 'mermaid-diagrams');
    expect(out).not.toMatch(/^version:/m);
    expect(out).not.toMatch(/^portable:/m);
    expect(out).toMatch(/^name: mermaid-diagrams$/m);
    expect(out).toContain('Body line.\n');
  });

  it('appends the deference line inside a quoted description', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', 'description: "Does things."']);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
  });

  // NOTA sobre el estilo de la salida: el transform ya no conserva el estilo de
  // comillas del fuente — emite SIEMPRE un escalar double-quoted via
  // JSON.stringify, sea cual sea la forma de entrada (plano, entrecomillado,
  // block scalar, multilinea). Antes habia una rama por forma, y cada vez que
  // el lector aprendia una forma nueva el escritor quedaba atras: asi se
  // colaron una deference line enterrada en medio de una descripcion
  // multilinea y otra tragada entera por un `#` de comentario. Un solo camino
  // hace imposible esa clase de divergencia. El contrato que estos tests
  // protegen — YAML valido que conserva descripcion + deference line — se
  // cumple igual, y se verifica reparseando la salida con js-yaml mas abajo.
  it('appends the deference line to an unquoted description', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', 'description: Does things.']);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: ${JSON.stringify(`Does things. ${DEFERENCE_LINE('x')}`)}`);
  });

  it('appends the deference line inside a single-quoted description', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', "description: 'Does things.'"]);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: ${JSON.stringify(`Does things. ${DEFERENCE_LINE('x')}`)}`);
  });

  it('appends the deference line inside a double-quoted description with trailing whitespace', () => {  // verifies R3.1
    const input = FM(['name: x', 'portable: true', 'description: "Does things."   ']);
    const out = claudeAiTransform(input, 'x');
    expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
  });

  it('accepts CRLF-terminated frontmatter', () => {  // verifies R3.4
    const input = '---\r\nname: x\r\nportable: true\r\ndescription: "Does things."\r\n---\r\nBody line.\r\n';
    const out = claudeAiTransform(input, 'x');
    expect(out).not.toMatch(/^portable:/m);
    expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
    expect(out).toContain('Body line.\r\n');
  });

  it('throws on missing frontmatter block', () => {  // verifies R3.4
    expect(() => claudeAiTransform('No frontmatter here.', 'x')).toThrow(/frontmatter/);
  });

  it('throws on unterminated frontmatter block', () => {  // verifies R3.4
    expect(() => claudeAiTransform('---\nname: x\ndescription: "D."\n', 'x')).toThrow(/unterminated/);
  });

  it('throws on frontmatter without description', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'portable: true']), 'x')).toThrow(/description/);
  });

  it('resuelve una descripcion en block scalar y le anexa la deference line (antes abortaba el export del bundle entero)', () => {  // verifies R3.4
    // Regresion real: esto lanzaba, y runExport propaga el throw — asi que UN
    // skill del registry baseline con esta forma valida (extract-design-md)
    // hacia fallar `awm export frontend` COMPLETO, no solo ese skill.
    const out = claudeAiTransform(FM(['name: x', 'description: >', '  folded text', '  segunda linea']), 'x');
    const descLine = out.split('\n').find((l) => l.startsWith('description:'));
    expect(descLine).toBe(`description: ${JSON.stringify(`folded text segunda linea ${DEFERENCE_LINE('x')}`)}`);
    // Las lineas indentadas del bloque se consumieron: no quedan sueltas.
    expect(out).not.toContain('  folded text');
    expect(out).not.toContain('description: >');
  });

  it('no absorbe las claves siguientes del frontmatter al consumir el bloque', () => {
    const out = claudeAiTransform(FM(['description: >-', '  solo esto', 'name: sigue-viva']), 'x');
    expect(out).toContain('name: sigue-viva');
    const descLine = out.split('\n').find((l) => l.startsWith('description:'));
    expect(descLine).toContain('solo esto');
    expect(descLine).not.toContain('sigue-viva');
  });

  it('sigue lanzando si el block scalar no tiene contenido', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'description: >-']), 'x')).toThrow(/no content/);
  });

  it('lanza si description esta presente pero vacia (sin valor y sin bloque)', () => {  // verifies R3.4
    expect(() => claudeAiTransform(FM(['name: x', 'description:']), 'x')).toThrow(/description is empty/);
  });

  it('resuelve un block scalar CON comentario final sin perder el contenido (regresion: guarda por prefijo vs match completo)', () => {
    // La guarda de la rama de bloque usaba un prefijo (/^[>|]/) mientras el
    // resolver exigia match COMPLETO del indicador. Con `>- # nota` entraban en
    // desacuerdo: se publicaba el indicador como descripcion y las lineas de
    // contenido REALES se borraban del artefacto exportado, en silencio.
    const out = claudeAiTransform(FM(['name: x', 'description: >- # nota al margen', '  el texto real']), 'x');
    const descLine = out.split('\n').find((l) => l.startsWith('description:'))!;
    expect(descLine).toContain('el texto real');
    expect(descLine).not.toContain('# nota al margen');
    expect(out).not.toContain('description: >-');
  });

  it('lanza ante un indicador de bloque malformado en vez de emitir YAML invalido', () => {
    // `>-basura` lo rechaza el propio YAML. Tratarlo como escalar plano emitiria
    // `description: >-basura ...`, invalido porque `>` abre un indicador.
    expect(() => claudeAiTransform(FM(['name: x', 'description: >-basura', '  texto']), 'x'))
      .toThrow(/malformed block scalar indicator/);
  });

  it('conserva la linea en blanco que separa el bloque de la clave siguiente', () => {
    const out = claudeAiTransform(FM(['description: >-', '  el texto', '', 'name: x']), 'x');
    expect(out).toMatch(/description: .*\n\nname: x/);
  });

  it('no deja que el apostrofe de la deference line rompa el escalar emitido', () => {  // verifies R3.4 (BLOCKER fix)
    // DEFERENCE_LINE siempre contiene un apostrofe ("registry's"). El fix
    // original lo doblaba ('') porque la salida era single-quoted; hoy la
    // salida es double-quoted, donde el apostrofe es un caracter comun. Lo
    // que el test protege no es la convencion de comillas sino que el
    // resultado sea YAML bien formado con el texto intacto — se verifica
    // reparseando con js-yaml en vez de inspeccionar comillas a ojo.
    const input = FM(['name: mermaid', 'portable: true', "description: 'Diagrams and flowcharts.'"]);
    const out = claudeAiTransform(input, 'mermaid');
    expect(descriptionOf(out)).toBe(`Diagrams and flowcharts. ${DEFERENCE_LINE('mermaid')}`);
    expect(descriptionOf(out)).toContain("registry's mermaid skill");
  });

  it('resuelve un escalar entrecomillado con comentario final en vez de lanzar', () => {  // verifies R3.4
    // Antes lanzaba. Pero `description: "x" # nota` es YAML valido y js-yaml lo
    // lee como "x": el comentario no forma parte del valor. Lanzar obligaba al
    // autor a tocar un SKILL.md que no tenia nada malo.
    const input = FM(['name: x', 'portable: true', 'description: "Does things." # a comment']);
    expect(descriptionOf(claudeAiTransform(input, 'x'))).toBe(`Does things. ${DEFERENCE_LINE('x')}`);
  });

  describe('round-trip: la salida se reparsea con un YAML real (par lector+escritor)', () => {
    // Los tests del lector, por si solos, no habrian detectado que el ESCRITOR
    // quedaba atras cuando el lector aprendia una forma nueva. Estos casos
    // pasan cada forma por el transform y REPARSEAN el resultado, que es donde
    // se ve si la deference line sobrevivio y si el YAML sigue siendo valido.
    it.each([
      ['plano', ['description: Does things.']],
      ['plano multilinea', ['description: primera parte', '  y su continuacion']],
      ['plano con comentario final', ['description: hola mundo # nota del autor']],
      ['single-quoted', ["description: 'con apostrofe: it''s'"]],
      ['double-quoted', ['description: "con dos puntos: si"']],
      ['folded', ['description: >-', '  primera', '  segunda']],
      ['literal', ['description: |-', '  primera', '  segunda']],
      ['folded con comentario en el indicador', ['description: >- # nota', '  el texto']],
    ])('%s', (_name, descLines) => {
      const out = claudeAiTransform(FM(['name: x', 'portable: true', ...descLines]), 'x');
      const desc = descriptionOf(out);   // lanza si la salida no es YAML valido
      // La deference line es la razon de existir de este transform: nunca puede
      // perderse en un comentario ni quedar sepultada en el medio del texto.
      expect(desc.endsWith(DEFERENCE_LINE('x'))).toBe(true);
    });
  });

  it('cleans intra-registry paths in the body', () => {  // verifies R2.1, R2.4
    const md = [
      '---',
      'name: product-discovery',
      'version: "1.0.0"',
      'portable: true',
      'description: "Explores problem space."',
      '---',
      'Hand off to `product-brief` (see `skills/product-brief/SKILL.md`) at the end.',
      '',
    ].join('\n');
    const out = claudeAiTransform(md, 'product-discovery');
    expect(out).toContain('Hand off to `product-brief` at the end.');
    expect(out).not.toContain('skills/product-brief/SKILL.md');
  });

  it('leaves the frontmatter block free of body rewriting', () => {  // verifies R2.4
    const md = [
      '---',
      'name: weird',
      'description: "Mentions skills/readiness-gate/SKILL.md inside the description."',
      '---',
      'Body with no paths.',
      '',
    ].join('\n');
    const out = claudeAiTransform(md, 'weird');
    expect(out).toContain('Mentions skills/readiness-gate/SKILL.md inside the description.');
  });
});

describe('stripIntraRegistryPaths', () => {
  it('drops a parenthetical whose only content is a see-path', () => {  // verifies R2.1
    expect(stripIntraRegistryPaths(
      'crystallize into a `product-brief` (see `skills/product-brief/SKILL.md`) — the handoff.',
    )).toBe('crystallize into a `product-brief` — the handoff.');
  });

  it('drops a bare-path parenthetical without leaving a space before the comma', () => {  // verifies R2.1
    expect(stripIntraRegistryPaths(
      'Same discipline as `brainstorming` (see `skills/brainstorming/SKILL.md`), applied at the business level.',
    )).toBe('Same discipline as `brainstorming`, applied at the business level.');
  });

  it('drops a parenthetical holding only a references path', () => {  // verifies R2.1
    expect(stripIntraRegistryPaths(
      "conforming to the brief contract's frontmatter (`skills/readiness-gate/references/brief-contract.md`), using:",
    )).toBe("conforming to the brief contract's frontmatter, using:");
  });

  it('rewrites a path in place when the parenthetical carries more text', () => {  // verifies R2.2, R2.3
    expect(stripIntraRegistryPaths(
      'the literal YAML block below (see `skills/readiness-gate/references/brief-contract.md` for the full normative rules).',
    )).toBe(
      "the literal YAML block below (see the `readiness-gate` skill's brief contract reference for the full normative rules).",
    );
  });

  it('rewrites a bare unquoted path in prose', () => {  // verifies R2.2, R2.3
    expect(stripIntraRegistryPaths(
      'shape are normative — see skills/readiness-gate/references/brief-contract.md.',
    )).toBe("shape are normative — see the `readiness-gate` skill's brief contract reference.");
  });

  it('renders a SKILL.md path as a nameless skill reference', () => {  // verifies R2.3
    expect(stripIntraRegistryPaths('invoke `skills/readiness-gate/SKILL.md` to certify it.'))
      .toBe('invoke the `readiness-gate` skill to certify it.');
  });

  it('leaves a GitHub URL containing the same path untouched', () => {  // verifies R2.6
    const url = 'see https://github.com/Kodria/awm-baseline-registry/blob/main/skills/readiness-gate/SKILL.md for the source.';
    expect(stripIntraRegistryPaths(url)).toBe(url);
  });

  it('leaves a markdown link whose target is a URL untouched', () => {  // verifies R2.6
    const link = '[the gate](https://github.com/Kodria/awm-baseline-registry/blob/main/skills/readiness-gate/references/brief-contract.md)';
    expect(stripIntraRegistryPaths(link)).toBe(link);
  });

  it('leaves prose with no intra-registry path byte-identical', () => {  // verifies R2.2
    const body = '# Heading\n\nA body that cites `docs/plans/x.md` and nothing else.\n';
    expect(stripIntraRegistryPaths(body)).toBe(body);
  });

  it('handles several paths in one body', () => {  // verifies R2.1, R2.2
    expect(stripIntraRegistryPaths(
      'hand off to `product-brief` (`skills/product-brief/SKILL.md`) then invoke `skills/readiness-gate/SKILL.md`.',
    )).toBe('hand off to `product-brief` then invoke the `readiness-gate` skill.');
  });

  it('rewrites a path immediately following a dropped parenthetical, even with no separator', () => {  // verifies R2.1, R2.2, R2.6 (regression: two-pass splicing bug found in code review)
    // Regression guard: a naive two-pass implementation (drop parentheticals,
    // THEN rewrite bare paths on the already-mutated string) can splice a
    // URL's trailing "/" directly against this path with zero separator,
    // making the URL-embedding guard misfire and silently skip the rewrite.
    expect(stripIntraRegistryPaths(
      'See http://x.com/y/ (see `skills/a/SKILL.md`)skills/b/SKILL.md now.',
    )).toBe('See http://x.com/y/the `b` skill now.');
  });

  it('rewrites a path that is the very first characters of the body', () => {
    // Exercises the pathStart === 0 boundary in isEmbeddedInUrl (pathStart > 0
    // must be false, not true, when the path opens the string) — every other
    // test in this file has text preceding the path, so this was untested.
    expect(stripIntraRegistryPaths('skills/readiness-gate/SKILL.md is required.'))
      .toBe('the `readiness-gate` skill is required.');
  });
});
