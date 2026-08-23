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

    it('un `skills` roto (archivo en vez de directorio) no impide seguir, y queda diagnosticado', () => {  // verifies R7.1
        const root = path.join(tmp, 'r3');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'skills'), 'no soy un directorio');
        let r: ReturnType<typeof discoverProcessModels> | undefined;
        expect(() => { r = discoverProcessModels([root]); }).not.toThrow();
        expect(r!.models).toEqual([]);
        expect(r!.diagnostics).toHaveLength(1);
        expect(r!.diagnostics[0]).toContain(root);
    });

    it('un SKILL.md roto (directorio en vez de archivo) no impide seguir, y queda diagnosticado', () => {  // verifies R7.1
        const root = path.join(tmp, 'r4');
        const skillMd = path.join(root, 'skills', 'roto', 'SKILL.md');
        fs.mkdirSync(skillMd, { recursive: true });
        let r: ReturnType<typeof discoverProcessModels> | undefined;
        expect(() => { r = discoverProcessModels([root]); }).not.toThrow();
        expect(r!.models).toEqual([]);
        expect(r!.diagnostics).toHaveLength(1);
        expect(r!.diagnostics[0]).toContain(skillMd);
        expect(r!.diagnostics[0]).toMatch(/cannot read/);
    });

    it('un SKILL.md simbolico apuntando fuera del registry no se lee: ni modelo ni contenido filtrado en diagnósticos', () => {  // verifies process-skillmd-symlink-arbitrary-read
        const root = path.join(tmp, 'r5');
        const skillDir = path.join(root, 'skills', 'malicioso');
        fs.mkdirSync(skillDir, { recursive: true });

        // Archivo "sensible" FUERA de la raíz del registry — simula ~/.ssh/id_rsa u otro
        // archivo local legible por el usuario que ejecuta `awm`.
        const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-outside-registry-'));
        const secretFile = path.join(secretDir, 'id_rsa');
        const SECRET_MARKER = 'SUPER-SECRET-PRIVATE-KEY-CONTENT-DO-NOT-LEAK';
        fs.writeFileSync(secretFile, `-----BEGIN OPENSSH PRIVATE KEY-----\n${SECRET_MARKER}\n-----END OPENSSH PRIVATE KEY-----\n`);

        const skillMd = path.join(skillDir, 'SKILL.md');
        fs.symlinkSync(secretFile, skillMd);

        let r: ReturnType<typeof discoverProcessModels> | undefined;
        expect(() => { r = discoverProcessModels([root]); }).not.toThrow();

        // Ningún modelo se construye a partir del symlink.
        expect(r!.models).toEqual([]);

        // Se reporta el problema, pero SOLO nombrando el path — nunca el contenido del
        // archivo apuntado. El nombre del archivo secreto en sí (id_rsa) sirve como proxy
        // de "esto no debería aparecer en diagnósticos" tanto como el contenido.
        expect(r!.diagnostics).toHaveLength(1);
        expect(r!.diagnostics[0]).toContain(skillMd);
        expect(r!.diagnostics[0]).toMatch(/symbolic link/i);

        const allDiagnosticsText = r!.diagnostics.join('\n');
        expect(allDiagnosticsText).not.toContain(SECRET_MARKER);
        expect(allDiagnosticsText).not.toContain('BEGIN OPENSSH PRIVATE KEY');

        fs.rmSync(secretDir, { recursive: true, force: true });
    });
});
