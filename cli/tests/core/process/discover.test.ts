// cli/tests/core/process/discover.test.ts
import { discoverProcessModels } from '../../../src/core/process/discover';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FIXTURE = `---
awm: process-model
schema: 1
name: NAME
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

## Objetivo

G — Objetivo.

## Cuándo aplica

Siempre.

## Estructura

- SG-1 — Uno
  - OP-1.1 — Hacer

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| Al empezar | | OP-1.1 | SG-1 |

## Terminación

none

## Sin verificar

- Nada.
`;

function registry(root: string, skills: Record<string, string>): string {
    for (const [name, content] of Object.entries(skills)) {
        fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), content);
    }
    return root;
}

describe('discoverProcessModels', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-discover-')); });
    afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('encuentra solo los SKILL.md con el discriminador', () => {              // verifies R1.1
        const root = registry(path.join(tmp, 'r1'), {
            'mi-proceso': FIXTURE.replace('NAME', 'mi-proceso'),
            'skill-normal': '---\nname: skill-normal\ndescription: otra cosa\n---\n\n# Normal\n',
        });
        const r = discoverProcessModels([root]);
        expect(r.models.map((m) => m.name)).toEqual(['mi-proceso']);
        expect(r.diagnostics).toEqual([]);
    });

    it('un modelo roto no impide descubrir los sanos', () => {                  // verifies R7.1
        const root = registry(path.join(tmp, 'r2'), {
            'sano': FIXTURE.replace('NAME', 'sano'),
            'roto': FIXTURE.replace('NAME', 'roto').replace('schema: 1', 'schema: cero'),
        });
        const r = discoverProcessModels([root]);
        expect(r.models.map((m) => m.name)).toEqual(['sano']);
        expect(r.diagnostics).toHaveLength(1);
    });

    it('deduplica por name entre registries y lo reporta', () => {              // verifies R1.1
        const a = registry(path.join(tmp, 'a'), { 'dup': FIXTURE.replace('NAME', 'dup') });
        const b = registry(path.join(tmp, 'b'), { 'dup': FIXTURE.replace('NAME', 'dup') });
        const r = discoverProcessModels([a, b]);
        expect(r.models).toHaveLength(1);
        expect(r.diagnostics.join(' ')).toMatch(/duplicates/i);
    });

    it('sin registries devuelve vacío sin diagnósticos', () => {                // verifies R7.1
        expect(discoverProcessModels([])).toEqual({ models: [], diagnostics: [] });
    });

    it('nunca lanza con un root inexistente', () => {                           // verifies R7.1
        expect(() => discoverProcessModels([path.join(tmp, 'no-existe')])).not.toThrow();
    });
});
