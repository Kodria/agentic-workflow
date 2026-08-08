// Regresion: `description: >-` (YAML block scalar) rompia `awm add <bundle>
// -a copilot|cursor` contra un skill REAL del registry baseline
// (skills/extract-design-md/SKILL.md, que usa exactamente esta forma).
//
// Un block scalar es YAML perfectamente valido: el indicador (`>-`, `|`, ...)
// va en la linea de la clave y el texto real vive en las lineas indentadas
// que siguen. El parser trataba el indicador como si fuera el valor, lo
// detectaba como "no es una descripcion de verdad", y lo colapsaba a ''  —
// que en `parseSkillSource` significa throw ("requires a non-empty
// description") y en `readArtifactDescription` significa degradar en
// silencio a descripcion vacia. Ninguno de los dos leia jamas las lineas
// siguientes, que es donde estaba el texto todo el tiempo.
import { parseSkillSource } from '../../../src/core/renderers/skill-source';
import { renderCursorMdc } from '../../../src/core/renderers/cursor-mdc';
import { renderCopilotInstructions } from '../../../src/core/renderers/copilot-instructions';

// Copia fiel del frontmatter de skills/extract-design-md/SKILL.md en
// awm-baseline-registry — el caso real que dispara el bug, no un fixture
// inventado.
const realBlockScalarSkill = `---
name: extract-design-md
version: "1.0.1"
description: >-
  Extract a comprehensive design system (DESIGN.md) directly from frontend source
  code — React, Vue, Svelte, Angular, plain HTML/CSS, or any web framework.
---

# Extract Design MD

Body content.
`;

describe('parseSkillSource: descripciones en block scalar (regresion real del registry)', () => {
    it('lee el texto de las lineas indentadas de un `>-`, en vez de tratar el indicador como el valor', () => {
        const { description } = parseSkillSource(realBlockScalarSkill);
        expect(description).toBe(
            'Extract a comprehensive design system (DESIGN.md) directly from frontend source ' +
            'code — React, Vue, Svelte, Angular, plain HTML/CSS, or any web framework.'
        );
    });

    it('pliega (folded, `>`) las lineas en espacios — no conserva los saltos de linea del fuente', () => {
        const source = `---
name: folded
description: >
  primera linea
  segunda linea
---

Body.
`;
        expect(parseSkillSource(source).description).toBe('primera linea segunda linea');
    });

    it('conserva los saltos de linea de un literal (`|`) — semantica YAML distinta de `>`', () => {
        const source = `---
name: literal
description: |
  primera linea
  segunda linea
---

Body.
`;
        expect(parseSkillSource(source).description).toBe('primera linea\nsegunda linea');
    });

    it('trata una linea en blanco dentro de un folded como separador de parrafo, no como espacio', () => {
        const source = `---
name: folded-parrafos
description: >-
  parrafo uno

  parrafo dos
---

Body.
`;
        expect(parseSkillSource(source).description).toBe('parrafo uno\nparrafo dos');
    });

    it('no absorbe las claves siguientes del frontmatter como parte del bloque (corta en la primera linea no indentada)', () => {
        const source = `---
description: >-
  solo esto pertenece al bloque
name: no-soy-parte-del-bloque
version: "9.9.9"
---

Body.
`;
        expect(parseSkillSource(source).description).toBe('solo esto pertenece al bloque');
    });

    it('resuelve el bloque igual con line endings CRLF (el repo es CRLF-tolerante y corre CI en windows-latest)', () => {
        const source = '---\r\nname: crlf\r\ndescription: >-\r\n  linea uno\r\n  linea dos\r\n---\r\n\r\nBody aqui.\r\n';
        expect(parseSkillSource(source).description).toBe('linea uno linea dos');
    });

    it('sigue lanzando si el bloque esta genuinamente vacio — un indicador sin lineas indentadas NO es una descripcion', () => {
        const source = `---
name: bloque-vacio
description: >-
name: otra-clave
---

Body.
`;
        expect(() => parseSkillSource(source)).toThrow(/non-empty description/);
    });
});

describe('renderers: el skill real del registry se renderiza para ambos providers', () => {
    it('renderCursorMdc emite la descripcion real, nunca el indicador `>-` literal', () => {
        const rendered = renderCursorMdc(realBlockScalarSkill);
        expect(rendered).toContain('Extract a comprehensive design system');
        // El modo de fallo que este test ancla: emitir el indicador crudo.
        expect(rendered).not.toContain('description: >-');
        expect(rendered).not.toContain('description: ""');
    });

    it('renderCopilotInstructions no crashea (no necesita la descripcion, pero parseSkillSource la exigia igual)', () => {
        const rendered = renderCopilotInstructions(realBlockScalarSkill);
        expect(rendered).toContain('applyTo: "**"');
        expect(rendered).toContain('# Extract Design MD');
    });
});
