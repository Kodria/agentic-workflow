import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const BUNDLES_SOURCE = path.join(ROOT, 'cli/src/core/bundles.ts');
const GUIDE = path.join(ROOT, 'docs/guides/authoring-a-registry-with-an-orchestrator.md');

const read = (file: string): string => fs.readFileSync(file, 'utf8');

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(file);
        return entry.isFile() && file.endsWith('.ts') ? [file] : [];
    });
}

function jsonFences(markdown: string): string[] {
    return Array.from(markdown.matchAll(/```json\n([\s\S]*?)\n```/g), ([, json]) => json);
}

describe('bundle skill-reference contract', () => {
    it('keeps active bundle consumers string-only, without BundleSkillRef', () => {
        const source = read(BUNDLES_SOURCE);

        const bundleSkillRefs = sourceFiles(path.join(ROOT, 'cli/src'))
            .filter((file) => /\bBundleSkillRef\b/.test(read(file)));

        expect(bundleSkillRefs).toEqual([]);
        expect(source).toMatch(/interface BundleDefinition\s*\{[\s\S]*?\bskills:\s*string\[\];/);
    });

    it('uses canonical string skill references in the active authoring guide', () => {
        const guide = read(GUIDE);
        const bundleExample = jsonFences(guide).find((json) => JSON.parse(json).name === 'mi-proceso');

        expect(bundleExample).toBeDefined();
        const skills = JSON.parse(bundleExample!).skills;
        expect(skills).toEqual(['mi-proceso']);
        expect(skills.every((skill: unknown) => typeof skill === 'string')).toBe(true);
    });

    it('places the CLI 9 migration boundary immediately after the bundle example', () => {
        const guide = read(GUIDE);
        const bundleFence = '```json\n{\n  "name": "mi-proceso"';
        const start = guide.indexOf(bundleFence);
        const end = guide.indexOf('```', start) + 3;
        const following = guide.slice(end, guide.indexOf('## 5.', end));

        expect(start).toBeGreaterThanOrEqual(0);
        expect(following).toMatch(/CLI 9[\s\S]*(?:legacy object|objeto legacy)[\s\S]*\{\s*name\s*,\s*onSignal:\s*true\s*\}/i);
        expect(following).toMatch(/ignor(?:e|a)[\s\S]*boolean[\s\S]*onSignal/i);
        expect(following).toMatch(/warning/i);
        expect(following).toMatch(/CLI 10[\s\S]*(?:rejects?|rechaza)[\s\S]*(?:objects?|objetos?)/i);
    });

    it('keeps every JSON fence in the touched guide parseable', () => {
        for (const json of jsonFences(read(GUIDE))) {
            expect(() => JSON.parse(json)).not.toThrow();
        }
    });
});
