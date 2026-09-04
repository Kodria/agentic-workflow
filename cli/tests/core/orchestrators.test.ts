import fs from 'fs';
import path from 'path';
import os from 'os';
import { diagnosticsToStderr } from '../../src/core/command-result';
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
        jest.restoreAllMocks();
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

    describe('single-line diagnostic boundary', () => {
        const hostile = 'before\u2028\u2029\u0085\r\n\t'
            + String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))
            + String.fromCharCode(...Array.from({ length: 33 }, (_, i) => 127 + i)) + 'after';

        it('sanitizes unknown metadata keys without accepting the declaration', () => {
            const root = registryWith({
                orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', [hostile]: true },
            });
            created.push(root);

            const result = readDeclaredOrchestrators(root);

            expect(result.orchestrators).toEqual([]);
            expect(result.diagnostics).toHaveLength(1);
            expect(result.diagnostics[0]).toContain('unknown field');
            expect(result.diagnostics[0]).toContain('before');
            expect(result.diagnostics[0]).toContain('after');
            const stderrBoundary = jest.fn(diagnosticsToStderr);
            stderrBoundary(result.diagnostics);
            expect(stderrBoundary.mock.calls[0][0].join('')).not.toMatch(/[\u2028\u0085]/);
            expect(stderrBoundary.mock.results[0].value).not.toMatch(/[\u2028\u0085]/);
            // eslint-disable-next-line no-control-regex -- reject all terminal controls and line separators
            expect(result.diagnostics[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
        });

        it.each(['inspection', 'read', 'parse', 'shape', 'fields'])('sanitizes %s diagnostics, including paths and error text', (branch) => {
            // Mock hostile paths instead of creating filenames that are invalid on Windows.
            const root = path.join(os.tmpdir(), hostile);
            const error = new Error(hostile);
            jest.spyOn(fs, 'lstatSync').mockImplementation(() => {
                if (branch === 'inspection') throw error;
                return { isFile: () => true, isSymbolicLink: () => false } as fs.Stats;
            });
            jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
                if (branch === 'read') throw error;
                if (branch === 'parse') return `{ ${hostile}`;
                return JSON.stringify({ orchestrator: branch === 'shape' ? [] : {} });
            });
            if (branch === 'parse') jest.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw new SyntaxError(hostile); });

            const result = readDeclaredOrchestrators(root);

            expect(result.orchestrators).toEqual([]);
            expect(result.diagnostics).toHaveLength(1);
            expect(result.diagnostics[0]).toContain('awm-registry.json');
            expect(result.diagnostics[0]).toContain('before');
            expect(result.diagnostics[0]).toContain('after');
            // eslint-disable-next-line no-control-regex -- reject all terminal controls and line separators
            expect(result.diagnostics[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
        });

        it('preserves valid raw fields and structural parsing without skill discovery', () => {
            const declaration = { name: hostile, appliesWhen: hostile, terminatesTo: hostile };
            const root = registryWith({ orchestrator: declaration });
            created.push(root);

            expect(readDeclaredOrchestrators(root)).toEqual({ orchestrators: [declaration], diagnostics: [] });
        });
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

    it('keeps missing-skill diagnostics single-line with hostile metadata and portable paths', () => {
        writeRegistriesConfig([{ name: 'first', remote: 'unused' }]);
        const nombreHostil = 'shared\r\nforged\t\x1b[31m\x00\x7f\x85\x9b\u2028\u2029';
        writeManifest('first', {
            orchestrator: { name: nombreHostil, appliesWhen: 'primero', terminatesTo: 'a' },
        });
        writeSkill('first', 'real-skill');

        const { diagnostics } = collectDeclaredOrchestrators();

        expect(diagnostics).toHaveLength(1);
        // eslint-disable-next-line no-control-regex -- diagnostic must contain no terminal controls or line separators
        expect(diagnostics[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
        expect(diagnostics[0]).toContain('shared');
        expect(diagnostics[0]).toContain('forged');
        expect(diagnostics[0]).toContain('declaration dropped');
    });

    it('keeps discovery diagnostics single-line for hostile override metadata', () => {
        writeRegistriesConfig([{ name: 'hostile', remote: 'unused' }]);
        writeManifest('hostile', { overrides: ['../forged\r\nwarning:\t\x1b[31m\x85\u2028'] });
        writeSkill('hostile', 'real-skill');

        const { diagnostics } = collectDeclaredOrchestrators();

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain('discovery unavailable');
        expect(diagnostics[0]).toContain('forged');
        // eslint-disable-next-line no-control-regex -- diagnostic must contain no terminal controls or line separators
        expect(diagnostics[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
    });

    it('excludes a later colliding root without losing earlier or subsequent healthy roots', () => {
        writeRegistriesConfig(['first', 'collision', 'last'].map((name) => ({ name, remote: 'unused' })));
        for (const name of ['first', 'collision', 'last']) {
            writeManifest(name, { orchestrator: { name: `${name}-process`, appliesWhen: 'x', terminatesTo: 'none' } });
            writeSkill(name, `${name}-process`);
        }
        writeSkill('first', 'shared');
        writeSkill('collision', 'shared');
        // This name belongs only to the excluded root and must not poison later admission.
        writeSkill('collision', 'last-process');

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared.map((d) => d.name)).toEqual(['first-process', 'last-process']);
        expect(diagnostics).toHaveLength(2);
        expect(diagnostics[0]).toMatch(/collision.*discovery unavailable.*Artifact name collision/);
        expect(diagnostics[1]).toMatch(/collision-process.*not discoverable/);
    });

    it('admits a later root with a declared override', () => {
        writeRegistriesConfig(['first', 'override'].map((name) => ({ name, remote: 'unused' })));
        writeSkill('first', 'shared');
        writeSkill('override', 'shared');
        writeSkill('override', 'override-process');
        writeManifest('override', {
            overrides: ['shared'],
            orchestrator: { name: 'override-process', appliesWhen: 'x', terminatesTo: 'none' },
        });

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared.map((d) => d.name)).toEqual(['override-process']);
        expect(diagnostics).toEqual([]);
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
