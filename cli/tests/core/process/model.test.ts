import yaml from 'js-yaml';
import { parseProcessFrontmatter } from '../../../src/core/process/model';

const valid = `---
awm: process-model
schema: 1
name: ejemplo-proceso
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

# Ejemplo
`;

describe('parseProcessFrontmatter', () => {
    it('acepta el modelo canónico', () => {                                    // verifies R1.2
        const r = parseProcessFrontmatter(valid, 'skills/x/SKILL.md');
        expect(r.diagnostics).toEqual([]);
        expect(r.model).toEqual(expect.objectContaining({
            schema: 1, name: 'ejemplo-proceso', status: 'draft', entryPoint: true, terminatesTo: 'none',
        }));
    });

    it('no infiere: sin el discriminador no es un modelo', () => {              // verifies R1.2
        const r = parseProcessFrontmatter(valid.replace('awm: process-model\n', ''), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics).toEqual([]);   // no es un error: es "no es un modelo"
    });

    it('se detiene ante un schema más nuevo en vez de leerlo como el anterior', () => {  // verifies R1.4
        const r = parseProcessFrontmatter(valid.replace('schema: 1', 'schema: 2'), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/newer/i);
    });

    it.each(['0', '-1', '1.5', 'uno'])('rechaza schema no-entero-positivo %s', (bad) => {  // verifies R1.3
        const r = parseProcessFrontmatter(valid.replace('schema: 1', `schema: ${bad}`), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics).not.toEqual([]);
    });

    it.each(['active', 'draft'])('admite status %s', (s) => {                   // verifies R1.9
        expect(parseProcessFrontmatter(valid.replace('status: draft', `status: ${s}`), 'p').model?.status).toBe(s);
    });

    it('rechaza un status inventado', () => {                                   // verifies R1.9
        const r = parseProcessFrontmatter(valid.replace('status: draft', 'status: published'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/status/);
    });

    it('rechaza un campo desconocido en vez de ignorarlo', () => {              // verifies R1.10
        const r = parseProcessFrontmatter(valid.replace('created:', 'api_token: ghp_x\ncreated:'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/unknown field/i);
    });

    it('rechaza un name que no es slug', () => {                                // verifies R1.2
        const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', 'name: ../../etc/passwd'), 'p');
        expect(r.model).toBeUndefined();
    });

    describe('YAML string slugs (FH-4)', () => {
        const YAML_STRING = /YAML string scalar|quote values YAML reads as null, boolean, or number/i;

        it.each(['null', 'true', '0x1f', '1e5', '01'])('rejects bare YAML non-string name: %s', (raw) => {
            const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', `name: ${raw}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(YAML_STRING);
            expect(r.diagnostics.join(' ')).toMatch(/"name"/);
        });

        it.each([
            ['"null"', 'null'],
            ['"demo-ok"', 'demo-ok'],
        ])('accepts quoted YAML string name %s', (raw, expected) => {
            const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', `name: ${raw}`), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.name).toBe(expected);
        });

        it('rejects terminates_to loaded as a non-string', () => {
            const r = parseProcessFrontmatter(valid.replace('terminates_to: none', 'terminates_to: 0x1f'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(YAML_STRING);
            expect(r.diagnostics.join(' ')).toMatch(/"terminates_to"/);
        });

        it.each(['none', '"none"'])('accepts terminates_to %s as none', (raw) => {
            const r = parseProcessFrontmatter(valid.replace('terminates_to: none', `terminates_to: ${raw}`), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.terminatesTo).toBe('none');
        });

        it('rejects a nested-alias bomb in name without calling yaml.load on it', () => {
            // Classic self-referential alias expansion; the pre-load guard must
            // refuse &/* (and never hang) before js-yaml sees the value.
            const bomb = '&a [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]';
            const load = jest.spyOn(yaml, 'load');
            try {
                const started = Date.now();
                const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', `name: ${bomb}`), 'p');
                expect(Date.now() - started).toBeLessThan(500);
                expect(r.model).toBeUndefined();
                expect(r.diagnostics.join(' ')).toMatch(YAML_STRING);
                expect(r.diagnostics.join(' ')).toMatch(/"name"/);
                expect(load.mock.calls.some(([arg]) => String(arg).includes(bomb))).toBe(false);
                expect(load.mock.calls.some(([arg]) => /[&*]/.test(String(arg)))).toBe(false);
            } finally {
                load.mockRestore();
            }
        });

        it('rejects a name raw longer than 128 characters without calling yaml.load on it', () => {
            const raw = `"${'a'.repeat(129)}"`;
            expect(raw.length).toBeGreaterThan(128);
            const load = jest.spyOn(yaml, 'load');
            try {
                const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', `name: ${raw}`), 'p');
                expect(r.model).toBeUndefined();
                expect(r.diagnostics.join(' ')).toMatch(YAML_STRING);
                expect(load.mock.calls.some(([arg]) => String(arg).includes(raw))).toBe(false);
            } finally {
                load.mockRestore();
            }
        });

        it('accepts name with a trailing plain comment that contains * (guard strips comment)', () => {
            const r = parseProcessFrontmatter(
                valid.replace('name: ejemplo-proceso', 'name: my-proc # tag*'),
                'p',
            );
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.name).toBe('my-proc');
        });

        it('rejects a description block with an alias-shaped token without calling yaml.load on the block', () => {
            // Alias token lives in a comment so readPairs stays clean; loadBlock must
            // refuse before yaml.load (same alias class as FH-4 slug guard). Slug
            // loads (`v: …`) may still run; the full block must not.
            const withDesc = valid.replace(
                'updated: 2026-08-23',
                'updated: 2026-08-23\ndescription: "ok"\n# &hostile_alias',
            );
            const load = jest.spyOn(yaml, 'load');
            try {
                const r = parseProcessFrontmatter(withDesc, 'p');
                expect(r.model).toBeUndefined();
                expect(r.diagnostics.join(' ')).toMatch(/"description" cannot be read: the frontmatter is not valid YAML/);
                expect(load.mock.calls.some(([arg]) => String(arg).includes('&hostile_alias'))).toBe(false);
                expect(load.mock.calls.some(([arg]) => String(arg).includes('description:'))).toBe(false);
            } finally {
                load.mockRestore();
            }
        });

        it('accepts a quoted description with bare & that is not an alias token', () => {
            const r = parseProcessFrontmatter(
                valid.replace('updated: 2026-08-23', 'updated: 2026-08-23\ndescription: "foo & bar"'),
                'p',
            );
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('foo & bar');
        });
    });

    describe('bounded frontmatter diagnostics (FH-5, FH-6)', () => {
        const FRONTMATTER_MAX = 65536;
        const blockOf = (source: string): string => source.slice(4, source.indexOf('\n---', 4));
        const withBlockLength = (source: string, target: number): string => {
            const pad = target - blockOf(source).length - 3;
            const next = source.replace('\ncreated:', `\n# ${'x'.repeat(pad)}\ncreated:`);
            expect(blockOf(next)).toHaveLength(target);
            return next;
        };

        it('rejects an oversized process-model block with a size diagnostic and no model', () => {
            const source = withBlockLength(valid, FRONTMATTER_MAX + 1);
            const load = jest.spyOn(yaml, 'load');
            try {
                const r = parseProcessFrontmatter(source, 'p');
                expect(r.model).toBeUndefined();
                expect(r.diagnostics.join(' ')).toMatch(/frontmatter exceeds 65536 characters/);
                expect(load).not.toHaveBeenCalled();
            } finally {
                load.mockRestore();
            }
        });

        it('stays silent for an oversized block without the process-model discriminator and never calls yaml.load', () => {
            const source = withBlockLength(valid.replace('awm: process-model\n', ''), FRONTMATTER_MAX + 1);
            const load = jest.spyOn(yaml, 'load');
            try {
                const r = parseProcessFrontmatter(source, 'p');
                expect(r.model).toBeUndefined();
                expect(r.diagnostics).toEqual([]);
                expect(load).not.toHaveBeenCalled();
            } finally {
                load.mockRestore();
            }
        });

        it('caps process-model problems at 20 and reports the remainder count', () => {
            const extras = Array.from({ length: 25 }, (_, i) => `unknown_${i}: x`).join('\n');
            const r = parseProcessFrontmatter(valid.replace('created:', `${extras}\ncreated:`), 'p');
            expect(r.model).toBeUndefined();
            const joined = r.diagnostics.join(' ');
            const unknownMentions = joined.match(/unknown field/g) ?? [];
            expect(unknownMentions.length).toBe(20);
            expect(joined).toContain('5 more problems');
        });

        it('truncates unknown field keys longer than 64 characters with an ellipsis', () => {
            const longKey = `k${'a'.repeat(199)}`;
            expect(longKey).toHaveLength(200);
            const r = parseProcessFrontmatter(valid.replace('created:', `${longKey}: x\ncreated:`), 'p');
            expect(r.model).toBeUndefined();
            const joined = r.diagnostics.join(' ');
            expect(joined).toMatch(/unknown field/);
            expect(joined).toContain(`${'a'.repeat(63)}…`);
            expect(joined).not.toContain(longKey);
        });

        it('truncates duplicate field keys longer than 64 characters with an ellipsis', () => {
            const longKey = `d${'b'.repeat(199)}`;
            expect(longKey).toHaveLength(200);
            const r = parseProcessFrontmatter(
                valid.replace('created:', `${longKey}: a\n${longKey}: b\ncreated:`),
                'p',
            );
            expect(r.model).toBeUndefined();
            const joined = r.diagnostics.join(' ');
            expect(joined).toMatch(/duplicate field/);
            expect(joined).toContain(`${'b'.repeat(63)}…`);
            expect(joined).not.toContain(longKey);
        });
    });

    it('nunca lanza ante entrada basura', () => {                               // verifies R1.4
        for (const junk of ['', '---\n', '---\n\x00\n---\n', 'no frontmatter']) {
            expect(() => parseProcessFrontmatter(junk, 'p')).not.toThrow();
        }
    });

    it.each(['si', 'True', '1', 'yes'])('rechaza un entry_point que no es true/false: %s', (bad) => {
        const r = parseProcessFrontmatter(valid.replace('entry_point: true', `entry_point: ${bad}`), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/"entry_point" must be true or false/);
    });

    it.each(['../../etc/passwd', 'None', 'Foo-Bar', 'has spaces'])('rechaza un terminates_to que no es slug ni "none": %s', (bad) => {
        const r = parseProcessFrontmatter(valid.replace('terminates_to: none', `terminates_to: ${bad}`), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/"terminates_to" must be a lowercase slug or "none"/);
    });

    it.each(['created', 'updated'] as const)('rechaza un %s con formato de fecha inválido', (field) => {
        const r = parseProcessFrontmatter(valid.replace(`${field}: 2026-08-23`, `${field}: 23-08-2026`), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(new RegExp(`${field}.*YYYY-MM-DD`));
    });

    it.each(['name', 'status', 'entry_point', 'terminates_to', 'created', 'updated'] as const)('rechaza si falta el campo requerido %s', (field) => {
        const withoutField = valid.split('\n').filter((line) => !line.startsWith(`${field}:`)).join('\n');
        const r = parseProcessFrontmatter(withoutField, 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(new RegExp(`"${field}" is required`));
    });

    describe('description (optional)', () => {
        const withDescription = (line: string): string => valid.replace('created:', `${line}\ncreated:`);

        it('is optional: a model without it parses unchanged and has no description key', () => {
            const r = parseProcessFrontmatter(valid, 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model).toBeDefined();
            expect(Object.prototype.hasOwnProperty.call(r.model, 'description')).toBe(false);
        });

        it.each([
            ['plain', 'description: Use when tracing a work session', 'Use when tracing a work session'],
            ['double-quoted', 'description: "Use when: tracing \\"sessions\\""', 'Use when: tracing "sessions"'],
            ['single-quoted', "description: 'It''s the entry point'", "It's the entry point"],
        ])('accepts a %s single-line value and exposes it resolved', (_kind, line, expected) => {
            const r = parseProcessFrontmatter(withDescription(line), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe(expected);
        });

        it('accepts exactly 1024 characters and rejects 1025', () => {
            expect(parseProcessFrontmatter(withDescription(`description: ${'a'.repeat(1024)}`), 'p').model?.description).toHaveLength(1024);
            const r = parseProcessFrontmatter(withDescription(`description: ${'a'.repeat(1025)}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must be at most 1024 characters/);
        });

        it.each(['description:', 'description: ""', "description: ''", 'description: "   "'])('rejects an empty value: %s', (line) => {
            const r = parseProcessFrontmatter(withDescription(line), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must not be empty/);
        });

        it.each(['description: >', 'description: >-', 'description: |', 'description: |2+', 'description: >-basura'])('rejects a block scalar header: %s', (line) => {
            const r = parseProcessFrontmatter(withDescription(`${line}\n  folded text`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must be a single-line string \(block scalars are not supported in a process model\)/);
        });

        it('still rejects every other unknown field next to a valid description', () => {
            const r = parseProcessFrontmatter(withDescription('description: ok\nsummary: nope'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/unknown field "summary"/);
            expect(r.diagnostics.join(' ')).not.toMatch(/unknown field "description"/);
        });

        it('rejects a duplicated description', () => {
            const r = parseProcessFrontmatter(withDescription('description: a\ndescription: b'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/duplicate field "description"/);
        });

        it.each([
            ['a block scalar', 'description: >-\n  SECRETVALUE here'],
            ['a plain multi-line value', 'description: first\n  SECRETVALUE second'],
            ['a quote closed on a later line', 'description: "hola\n  SECRETVALUE mundo"'],
        ])('reports %s by line position and never echoes its content', (_kind, lines) => {
            // Bloque del fixture: awm(1) … terminates_to(6); la línea description
            // queda en 7 y su continuación en 8.
            const r = parseProcessFrontmatter(withDescription(lines), 'p');
            expect(r.model).toBeUndefined();
            for (const d of r.diagnostics) expect(d).not.toContain('SECRETVALUE');
            expect(r.diagnostics.join(' ')).toContain('frontmatter line 8 is not a "key: value" pair (multi-line values are not supported)');
        });

        it.each([
            ['a plain value', 'description: Use for\n  SECRETKEY: when X', false],
            ['a block scalar', 'description: >-\n  SECRETKEY: x', true],
        ])('treats an indented "KEY: x" after %s as a continuation, never as a field', (_kind, lines, isBlock) => {
            const r = parseProcessFrontmatter(withDescription(lines), 'p');
            expect(r.model).toBeUndefined();
            for (const d of r.diagnostics) expect(d).not.toContain('SECRETKEY');
            expect(r.diagnostics.join(' ')).toContain('frontmatter line 8 is not a "key: value" pair (multi-line values are not supported)');
            if (isBlock) {
                expect(r.diagnostics.join(' ')).toMatch(/"description" must be a single-line string \(block scalars are not supported in a process model\)/);
            }
        });

        const PARSE_ERROR = /"description" cannot be read: the frontmatter is not valid YAML/;
        const NOT_A_STRING = /"description" must be a string \(quote values YAML reads as a boolean, a number, a date or a collection\)/;

        it.each([
            '- foo', '? foo', 'a:\tb', 'Use when: tracing', '"hola', "'hola", "'hola # x", '"hola # x', '"a" junk',
            'ends with colon:', '@x', '\x1b',
        ])('rejects a value YAML cannot parse as a single-line string: %j', (value) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(PARSE_ERROR);
        });

        it.each(['true', '123', '2026-01-01', '[a, b]'])('rejects a value YAML reads as a non-string: %s', (value) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(NOT_A_STRING);
        });

        it.each(['null', '~', '# x'])('rejects a value YAML reads as null as empty: %s', (value) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must not be empty/);
        });

        it('never echoes the value or the YAML error text into a diagnostic', () => {
            const r = parseProcessFrontmatter(withDescription('description: SECRETVALUE: x'), 'p');
            expect(r.diagnostics.join(' ')).toMatch(PARSE_ERROR);
            for (const d of r.diagnostics) expect(d).not.toContain('SECRETVALUE');
        });

        it('resolves YAML double-quoted escapes', () => {
            expect(parseProcessFrontmatter(withDescription('description: "\\x41"'), 'p').model?.description).toBe('A');
        });

        it('stores the YAML string untrimmed', () => {
            expect(parseProcessFrontmatter(withDescription('description: "  padded  "'), 'p').model?.description).toBe('  padded  ');
        });

        it.each([
            ['description: "Use when: tracing"', 'Use when: tracing'],
            ["description: 'It''s'", "It's"],
        ])('accepts the quoted form %s', (line, expected) => {
            const r = parseProcessFrontmatter(withDescription(line), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe(expected);
        });

        const blockOf = (source: string): string => source.slice(4, source.indexOf('\n---', 4));
        /** Modelo válido con description `ok` cuyo bloque de frontmatter mide exactamente `target`. */
        const withBlockLength = (target: number): string => {
            const base = withDescription('description: ok');
            const pad = target - blockOf(base).length - 3;
            const source = base.replace('\ncreated:', `\n# ${'x'.repeat(pad)}\ncreated:`);
            expect(blockOf(source)).toHaveLength(target);
            return source;
        };

        it('parses a frontmatter block of exactly 65536 characters', () => {
            const r = parseProcessFrontmatter(withBlockLength(65536), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('ok');
        });

        it('rejects a frontmatter block over 65536 characters at the size gate without parsing it', () => {
            // FH-5: process-model discriminator + oversized block → size diagnostic
            // before readPairs / description YAML load (no longer the 1024 path).
            const source = withBlockLength(65537);
            const load = jest.spyOn(yaml, 'load');
            try {
                const r = parseProcessFrontmatter(source, 'p');
                expect(r.model).toBeUndefined();
                expect(r.diagnostics.join(' ')).toMatch(/frontmatter exceeds 65536 characters/);
                expect(load).not.toHaveBeenCalled();
            } finally {
                load.mockRestore();
            }
        });

        it('accepts a short value followed by a 20000-character comment', () => {
            const r = parseProcessFrontmatter(withDescription(`description: ok # ${'x'.repeat(20000)}`), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('ok');
        });

        it('accepts an escape-heavy value that resolves to 1024 code points', () => {
            const r = parseProcessFrontmatter(withDescription(`description: "${'\\x41'.repeat(1024)}"`), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('A'.repeat(1024));
        });

        it('preserves NBSP, U+3000 and BOM exactly as YAML reads them', () => {
            const r = parseProcessFrontmatter(withDescription('description: \u00A0hello\u3000world\uFEFF'), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('\u00A0hello\u3000world\uFEFF');
        });

        it('rejects description:value with no space after the colon', () => {
            const r = parseProcessFrontmatter(withDescription('description:value'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(PARSE_ERROR);
        });

        const CONTROL = /"description" must not contain control, line-break or bidirectional-override characters/;

        it.each([
            '"a\\nb"', '"a\\rb"', '"\\0"', '"\\e[31m"', '"\\x7f"', '"\\x85"', '"\\x9f"',
            '"a\\u2028b"', '"a\\u2029b"', '"\\u202A"', '"\\u202E"', '"\\u2066"', '"\\u2069"',
            '"\\uD800"', '"\\uDC00"', 'a\u2028b', 'a\u2029b', 'a\u202Eb', 'a\u0085b',
        ])('rejects control, line-break, bidi or lone-surrogate content: %j', (value) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(CONTROL);
        });

        it.each([
            ['an escaped tab', '"a\\tb"', 'a\tb'],
            ['a surrogate pair', '"\\uD83D\\uDE00"', '\u{1F600}'],
        ])('accepts %s', (_kind, value, expected) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe(expected);
        });

        it.each(['"\\u200B"', '"\\u200B\\u200C\\u200D"', '"\\u2060\\uFEFF "'])('rejects a value made only of zero-width characters as empty: %j', (value) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must not be empty/);
        });

        it.each(['"a\\bb"', '"a\\x1fb"', '"a\\u200Eb"', '"a\\u200Fb"', '"a\\u061Cb"'])('rejects backspace, US and LRM/RLM/ALM: %j', (value) => {
            const r = parseProcessFrontmatter(withDescription(`description: ${value}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(CONTROL);
        });

        const DIVERGES = /"description" cannot be read: the frontmatter does not read the same as YAML \(check quotes and line breaks\)/;

        it('rejects a bare CR that smuggles a second top-level key', () => {
            const r = parseProcessFrontmatter(withDescription('description: hello\rallowed-tools: x'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(DIVERGES);
            for (const d of r.diagnostics) expect(d).not.toContain('allowed-tools');
        });

        it('rejects an unclosed quote that YAML folds into the following name line', () => {
            const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', 'description: "hola\nname: ejemplo-proceso"'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(DIVERGES);
        });

        it('validates a description that follows a comment on a bare CR', () => {
            const bad = parseProcessFrontmatter(withDescription('#\rdescription: 123'), 'p');
            expect(bad.model).toBeUndefined();
            expect(bad.diagnostics.join(' ')).toMatch(NOT_A_STRING);
            const ok = parseProcessFrontmatter(withDescription('#\rdescription: ok'), 'p');
            expect(ok.diagnostics).toEqual([]);
            expect(ok.model?.description).toBe('ok');
        });

        it('reads NBSP followed by > as a string, not as a block-scalar header', () => {
            const r = parseProcessFrontmatter(withDescription('description: \u00A0>'), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('\u00A0>');
        });

        it.each([['NEL', '\u0085'], ['LS', '\u2028'], ['PS', '\u2029']])('rejects a %s inside a comment line by position', (_kind, ch) => {
            const r = parseProcessFrontmatter(withDescription(`# SECRET${ch}name: smuggled`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toContain('frontmatter line 7 contains a YAML 1.1 line break (NEL, LS or PS)');
            for (const d of r.diagnostics) expect(d).not.toContain('SECRET');
        });

        it.each([['NEL', '\u0085'], ['LS', '\u2028'], ['PS', '\u2029']])('rejects a %s inside a value line of any field by position', (_kind, ch) => {
            const inDescription = parseProcessFrontmatter(withDescription(`description: a${ch}b`), 'p');
            expect(inDescription.model).toBeUndefined();
            expect(inDescription.diagnostics.join(' ')).toContain('frontmatter line 7 contains a YAML 1.1 line break (NEL, LS or PS)');
            const inName = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', `name: ejemplo${ch}proceso`), 'p');
            expect(inName.model).toBeUndefined();
            expect(inName.diagnostics.join(' ')).toContain('frontmatter line 3 contains a YAML 1.1 line break (NEL, LS or PS)');
        });

        it.each(['description: "foo\n# bar"', "description: 'foo\n# bar'"])('rejects a quoted value that YAML folds across a following comment line: %j', (lines) => {
            const r = parseProcessFrontmatter(withDescription(lines), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must be a single-line string \(block scalars are not supported in a process model\)/);
            for (const d of r.diagnostics) expect(d).not.toContain('bar');
        });

        it.each([
            ['description: "Use when: tracing a work session"', 'Use when: tracing a work session'],
            ['description: Use when tracing a work session # nota', 'Use when tracing a work session'],
            ["description: 'It''s the entry point' # nota", "It's the entry point"],
            ['description: "Traza la sesión \\u2014 sin perder pasos"\n# comentario aparte', 'Traza la sesión \u2014 sin perder pasos'],
        ])('keeps accepting a realistic description: %j', (lines, expected) => {
            const r = parseProcessFrontmatter(withDescription(lines), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe(expected);
        });

        it('lists description in the unknown-field message', () => {
            const r = parseProcessFrontmatter(withDescription('summary: nope'), 'p');
            expect(r.diagnostics.join(' ')).toMatch(/the contract admits only [^;]*\bdescription\b/);
        });

        it('accepts a closed quote followed by a comment', () => {
            const r = parseProcessFrontmatter(withDescription('description: "a" # note'), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('a');
        });

        it('rejects a comment-only value as empty and never echoes it', () => {
            const r = parseProcessFrontmatter(withDescription('description: # x'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must not be empty/);
            for (const d of r.diagnostics) expect(d).not.toContain('# x');
        });

        it('counts the 1024 limit in code points, not UTF-16 units', () => {
            const ok = parseProcessFrontmatter(withDescription(`description: ${'😀'.repeat(1024)}`), 'p');
            expect(ok.diagnostics).toEqual([]);
            expect([...(ok.model?.description ?? '')]).toHaveLength(1024);
            const tooLong = parseProcessFrontmatter(withDescription(`description: ${'😀'.repeat(1025)}`), 'p');
            expect(tooLong.model).toBeUndefined();
            expect(tooLong.diagnostics.join(' ')).toMatch(/"description" must be at most 1024 characters/);
        });

        it('keeps skipping an indented comment line after a valid description', () => {
            const r = parseProcessFrontmatter(withDescription('description: ok\n  # comentario'), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('ok');
        });

        it('accepts a plain value followed by a comment, without the comment', () => {
            const r = parseProcessFrontmatter(withDescription('description: plain text # note'), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('plain text');
        });

        it('accepts escaped quotes inside a closed double-quoted value', () => {
            const r = parseProcessFrontmatter(withDescription('description: "a \\"b\\""'), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe('a "b"');
        });

        it('never throws on hostile description values', () => {
            for (const line of ['description: "unclosed', "description: '''", 'description: \x00', `description: ${'"'.repeat(5000)}`]) {
                expect(() => parseProcessFrontmatter(withDescription(line), 'p')).not.toThrow();
            }
        });
    });

    describe('indented frontmatter keys', () => {
        const indentAll = (source: string): string =>
            source.replace(/^---\n([\s\S]*?)\n---/, (_m, block: string) => `---\n${block.split('\n').map((l) => `  ${l}`).join('\n')}\n---`);

        it('reports a model whose keys are all indented instead of ignoring it', () => {
            const r = parseProcessFrontmatter(indentAll(valid), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics).toEqual(['p: invalid process model — frontmatter keys must not be indented (frontmatter line 1)']);
        });

        it('allows whitespace around the colon and counts comment lines', () => {
            const r = parseProcessFrontmatter('---\n# nota\n  awm :  process-model\n  name: x\n---\n', 'p');
            expect(r.diagnostics).toEqual(['p: invalid process model — frontmatter keys must not be indented (frontmatter line 2)']);
        });

        it.each([
            ['another indented value', '---\nname: x\nmetadata:\n  awm: other\n---\n'],
            ['a mention nested under metadata', '---\nname: x\nmetadata:\n  awm: process-model\n---\n'],
            ['a mention inside a block-scalar description', '---\nname: x\ndescription: >\n  awm: process-model\n---\n'],
            ['a near-miss discriminator', '---\n  awm: process-model-x\n  name: x\n---\n'],
        ])('stays silent for a non-model with %s', (_kind, source) => {
            expect(parseProcessFrontmatter(source, 'p')).toEqual({ diagnostics: [] });
        });

        it.each([
            ['only the awm line indented', valid.replace('awm: process-model', '  awm: process-model')],
            ['a tab-indented awm line', valid.replace('awm: process-model', '\tawm: process-model')],
        ])('reports %s even though YAML cannot load the block', (_kind, source) => {
            expect(parseProcessFrontmatter(source, 'p')).toEqual({
                diagnostics: ['p: invalid process model — frontmatter keys must not be indented (frontmatter line 1)'],
            });
        });

        it('gives no indented diagnostic to a top-level-awm model with a nested metadata.awm', () => {
            const r = parseProcessFrontmatter(valid.replace('created:', 'metadata:\n  awm: process-model\ncreated:'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).not.toMatch(/must not be indented/);
        });

        it('rejects an oversized indented process-model with a size diagnostic and never calls yaml.load', () => {
            // FH-5 (QA amend): indented awm: process-model in an oversized/unclosed
            // prefix must surface the size diagnostic, not silence.
            const source = indentAll(valid.replace('\ncreated:', `\n# ${'x'.repeat(65536)}\ncreated:`));
            const load = jest.spyOn(yaml, 'load');
            try {
                const r = parseProcessFrontmatter(source, 'p');
                expect(r.model).toBeUndefined();
                expect(r.diagnostics.join(' ')).toMatch(/frontmatter exceeds 65536 characters/);
                expect(load).not.toHaveBeenCalled();
            } finally {
                load.mockRestore();
            }
        });
    });
});
