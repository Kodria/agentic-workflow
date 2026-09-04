import fs from 'fs';
import path from 'path';
import os from 'os';
import { readDeclaredOrchestrators, collectDeclaredOrchestrators } from '../../src/core/orchestrators';
import { writeRegistriesConfig, registryContentRoot } from '../../src/core/registries';

function registryWith(manifest: unknown): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify(manifest));
    return root;
}

describe('readDeclaredOrchestrators', () => {
    const created: string[] = [];
    afterEach(() => {
        for (const r of created.splice(0)) fs.rmSync(r, { recursive: true, force: true });
    });

    it('lee una declaracion valida', () => {           // verifies R1.1
        const root = registryWith({
            minCliVersion: '8.1.5',
            orchestrator: { name: 'mi-proceso', appliesWhen: 'cuando arranco una tarea', terminatesTo: 'development-process' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics).toEqual([]);
        expect(orchestrators).toHaveLength(1);
        expect(orchestrators[0]).toEqual({
            name: 'mi-proceso',
            appliesWhen: 'cuando arranco una tarea',
            terminatesTo: 'development-process',
        });
    });

    it('un registry sin bloque orchestrator no declara nada y no es un error', () => {  // verifies R1.4
        const root = registryWith({ minCliVersion: '8.1.5' });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('un registry sin manifiesto no declara nada y no es un error', () => {           // verifies R1.4
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('rechaza una declaracion malformada SIN lanzar, reportandola', () => {           // verifies R1.2
        const root = registryWith({ orchestrator: { name: 'mi-proceso' } });            // falta appliesWhen y terminatesTo
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/appliesWhen/);
    });

    it('rechaza un campo string en blanco (solo espacios) sin lanzar, reportandolo', () => {  // verifies Finding 4: value.trim() === '' branch
        const root = registryWith({ orchestrator: { name: 'x', appliesWhen: '   ', terminatesTo: 'none' } });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/appliesWhen/);
    });

    it('orchestrator: null se rechaza SIN lanzar, reportandolo', () => {               // verifies Finding 3
        const root = registryWith({ orchestrator: null });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('orchestrator: [] (array) se rechaza SIN lanzar — prueba que Array.isArray se chequea, no solo === null', () => {  // verifies Finding 3
        const root = registryWith({ orchestrator: [] });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('orchestrator: 5 (numero) se rechaza SIN lanzar', () => {                       // verifies Finding 3
        const root = registryWith({ orchestrator: 5 });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('orchestrator: "x" (string) se rechaza SIN lanzar', () => {                     // verifies Finding 3
        const root = registryWith({ orchestrator: 'x' });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('rechaza un campo que excede la longitud maxima permitida', () => {              // verifies Finding 1
        const root = registryWith({
            orchestrator: { name: 'x'.repeat(501), appliesWhen: 'y', terminatesTo: 'none' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/"name"/);
        expect(diagnostics[0]).toMatch(/500|maximum|exceeds/i);
    });

    it('acepta un campo justo en el limite de longitud maxima (500 caracteres)', () => {  // verifies Finding 1
        const root = registryWith({
            orchestrator: { name: 'x'.repeat(500), appliesWhen: 'y', terminatesTo: 'none' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics).toEqual([]);
        expect(orchestrators).toHaveLength(1);
    });

    it('un manifiesto con JSON invalido se reporta, no explota', () => {                // verifies R1.2
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        created.push(root);
        fs.writeFileSync(path.join(root, 'awm-registry.json'), '{ no es json');
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
    });

    it('una declaracion invalida no invalida las validas de otros registries', () => {  // verifies R1.2
        const bad = registryWith({ orchestrator: { name: 'roto' } });
        const good = registryWith({
            orchestrator: { name: 'sano', appliesWhen: 'siempre', terminatesTo: 'none' },
        });
        created.push(bad, good);
        const all = [bad, good].map(readDeclaredOrchestrators);
        expect(all[0].orchestrators).toEqual([]);
        expect(all[1].orchestrators).toHaveLength(1);
        expect(all[1].diagnostics).toEqual([]);
    });

    it('rechaza campos de precedencia: no son vocabulario del framework', () => {       // verifies R1.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', precedence: 1 },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics[0]).toMatch(/unknown field "precedence"/i);
    });

    it('rechaza una declaracion que traiga secretos', () => {                            // verifies R5.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', token: 'ghp_abc' },
        });
        created.push(root);
        const { diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics[0]).toMatch(/unknown field "token"/i);
    });

    it('rechaza un manifiesto simlinkeado sin lanzar, reportandolo', () => {             // verifies R1.2
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-outside-'));
        created.push(root, outside);
        fs.writeFileSync(path.join(outside, 'awm-registry.json'), JSON.stringify({
            orchestrator: { name: 'sano', appliesWhen: 'siempre', terminatesTo: 'none' },
        }));
        fs.symlinkSync(path.join(outside, 'awm-registry.json'), path.join(root, 'awm-registry.json'));

        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/symbolic link/i);
    });

    it('un nombre de campo con salto de linea no forja lineas de log adicionales', () => { // verifies R5.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', 'evil\nfake-warning: injected line': true },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].split('\n')).toHaveLength(1);
        expect(diagnostics[0]).toContain(JSON.stringify('evil\nfake-warning: injected line'));
    });
});

describe('collectDeclaredOrchestrators', () => {
    // Isolates AWM_HOME per CLAUDE.md's testing rule ("ningun test puede tocar el ~/.awm
    // real") — mirrors the pattern in tests/core/context/orchestrator.test.ts.
    let isolatedAwmHome: string;
    let originalAwmHomeEnv: string | undefined;

    beforeEach(() => {
        isolatedAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-collect-home-'));
        originalAwmHomeEnv = process.env.AWM_HOME;
        process.env.AWM_HOME = isolatedAwmHome;
    });

    afterEach(() => {
        if (originalAwmHomeEnv === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHomeEnv;
        fs.rmSync(isolatedAwmHome, { recursive: true, force: true });
    });

    function writeManifest(name: string, manifest: unknown): void {
        const root = registryContentRoot(name);
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify(manifest));
    }

    function writeSkill(registryName: string, skillName: string): void {
        const skillDir = path.join(registryContentRoot(registryName), 'skills', skillName);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${skillName}\n---\n\n# ${skillName}\n`);
    }

    it('dedupea por nombre entre dos registries, conservando el primero por orden de registries.json', () => {  // verifies Finding 2
        writeRegistriesConfig([
            { name: 'first', remote: 'unused' },
            { name: 'second', remote: 'unused' },
        ]);
        writeManifest('first', {
            orchestrator: { name: 'shared', appliesWhen: 'primero', terminatesTo: 'a' },
        });
        writeManifest('second', {
            orchestrator: { name: 'shared', appliesWhen: 'segundo', terminatesTo: 'b' },
        });
        writeSkill('first', 'shared');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toHaveLength(1);
        expect(declared[0]).toEqual({ name: 'shared', appliesWhen: 'primero', terminatesTo: 'a' });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/shared/);
        expect(diagnostics[0]).toMatch(/duplicate|shadow/i);
    });

    it('sanea el nombre antes de interpolarlo en el diagnostico de duplicado', () => {  // verifies confirmed Finding 3
        writeRegistriesConfig([
            { name: 'first', remote: 'unused' },
            { name: 'second', remote: 'unused' },
        ]);
        const nombreHostil = 'shared\x1b[31m';
        writeManifest('first', {
            orchestrator: { name: nombreHostil, appliesWhen: 'primero', terminatesTo: 'a' },
        });
        writeManifest('second', {
            orchestrator: { name: nombreHostil, appliesWhen: 'segundo', terminatesTo: 'b' },
        });
        writeSkill('first', nombreHostil);

        const { diagnostics } = collectDeclaredOrchestrators();

        expect(diagnostics).toHaveLength(1);
        // eslint-disable-next-line no-control-regex -- verificamos la ausencia deliberada de C0
        expect(diagnostics[0]).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
        expect(diagnostics[0]).toContain('shared[31m');
    });

    it('emite un diagnostico de colision post-saneo entre nombres crudos distintos, sin descartar ninguno', () => {  // verifies confirmed Finding 4
        writeRegistriesConfig([
            { name: 'first', remote: 'unused' },
            { name: 'second', remote: 'unused' },
        ]);
        writeManifest('first', {
            orchestrator: { name: 'foo_bar', appliesWhen: 'x', terminatesTo: 'a' },
        });
        writeManifest('second', {
            orchestrator: { name: 'foobar', appliesWhen: 'y', terminatesTo: 'b' },
        });
        writeSkill('first', 'foo_bar');
        writeSkill('second', 'foobar');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        // Ambas declaraciones son genuinamente distintas (nombre crudo distinto) — ninguna se descarta.
        expect(declared).toHaveLength(2);
        expect(declared.map((d) => d.name).sort()).toEqual(['foo_bar', 'foobar']);
        // Pero se advierte de la colision post-saneo (ambas renderizan como "foobar").
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/foobar/);
        expect(diagnostics[0]).toMatch(/collis|same composed name/i);
    });

    it('no dedupea orquestadores con nombres distintos, ambos se conservan', () => {
        writeRegistriesConfig([
            { name: 'first', remote: 'unused' },
            { name: 'second', remote: 'unused' },
        ]);
        writeManifest('first', {
            orchestrator: { name: 'uno', appliesWhen: 'x', terminatesTo: 'a' },
        });
        writeManifest('second', {
            orchestrator: { name: 'dos', appliesWhen: 'y', terminatesTo: 'b' },
        });
        writeSkill('first', 'uno');
        writeSkill('second', 'dos');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toHaveLength(2);
        expect(declared.map((d) => d.name).sort()).toEqual(['dos', 'uno']);
        expect(diagnostics).toEqual([]);
    });

    it('omite una declaracion cuyo skill no existe y la diagnostica', () => {
        writeRegistriesConfig([{ name: 'phantom', remote: 'unused' }]);
        writeManifest('phantom', {
            orchestrator: { name: 'phantom-process', appliesWhen: 'x', terminatesTo: 'none' },
        });
        writeSkill('phantom', 'real-skill');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/phantom-process/);
        expect(diagnostics[0]).toMatch(/declaration dropped|skill/i);
    });

    it('resuelve una declaracion contra un skill de otro registry configurado', () => {
        writeRegistriesConfig([
            { name: 'declarations', remote: 'unused' },
            { name: 'skills', remote: 'unused' },
        ]);
        writeManifest('declarations', {
            orchestrator: { name: 'cross-registry', appliesWhen: 'x', terminatesTo: 'none' },
        });
        writeSkill('skills', 'cross-registry');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toEqual([{ name: 'cross-registry', appliesWhen: 'x', terminatesTo: 'none' }]);
        expect(diagnostics).toEqual([]);
    });

    it('diagnostica un root cuyo discovery falla y conserva una declaracion sana', () => {
        writeRegistriesConfig([
            { name: 'broken', remote: 'unused' },
            { name: 'healthy', remote: 'unused' },
        ]);
        writeManifest('broken', {
            orchestrator: { name: 'broken-process', appliesWhen: 'x', terminatesTo: 'none' },
        });
        fs.writeFileSync(path.join(registryContentRoot('broken'), 'skills'), 'not a directory');
        writeManifest('healthy', {
            orchestrator: { name: 'healthy-process', appliesWhen: 'x', terminatesTo: 'none' },
        });
        writeSkill('healthy', 'healthy-process');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toEqual([{ name: 'healthy-process', appliesWhen: 'x', terminatesTo: 'none' }]);
        expect(diagnostics.join('\n')).toMatch(/broken.*discovery unavailable/i);
    });

    it('conserva terminatesTo aunque no corresponda a un skill descubierto', () => {
        writeRegistriesConfig([{ name: 'registry', remote: 'unused' }]);
        writeManifest('registry', {
            orchestrator: { name: 'entry-process', appliesWhen: 'x', terminatesTo: 'missing-successor' },
        });
        writeSkill('registry', 'entry-process');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toEqual([{ name: 'entry-process', appliesWhen: 'x', terminatesTo: 'missing-successor' }]);
        expect(diagnostics).toEqual([]);
    });
});
