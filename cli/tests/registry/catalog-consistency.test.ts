import fs from 'fs';
import path from 'path';

const CONTENT = path.join(__dirname, '../../../registry');

function readJson(p: string): any { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

describe('catalog/bundle consistency', () => {
    const catalog = readJson(path.join(CONTENT, 'catalog.json'));

    it('declares exactly the 5 bundles', () => {
        expect(catalog.bundles.map((b: any) => b.name).sort())
            .toEqual(['authoring', 'dev', 'docs', 'frontend', 'personal-notion']);
    });

    it('every catalog entry has a matching bundle.json whose mirrored fields agree', () => {
        for (const entry of catalog.bundles) {
            const manifest = readJson(path.join(CONTENT, entry.source, 'bundle.json'));
            expect(manifest.name).toBe(entry.name);
            expect(manifest.scope).toBe(entry.scope);
            expect(manifest.version).toBe(entry.version);
            expect(manifest.visibility ?? 'public').toBe(entry.visibility ?? 'public');
        }
    });

    it('every referenced skill exists in registry/skills', () => {
        for (const entry of catalog.bundles) {
            const manifest = readJson(path.join(CONTENT, entry.source, 'bundle.json'));
            for (const s of manifest.skills) {
                const name = typeof s === 'string' ? s : s.name;
                expect(fs.existsSync(path.join(CONTENT, 'skills', name, 'SKILL.md'))).toBe(true);
            }
        }
    });

    it('bundle skills partition the 44 skills with no overlap', () => {
        const all: string[] = [];
        for (const entry of catalog.bundles) {
            const manifest = readJson(path.join(CONTENT, entry.source, 'bundle.json'));
            for (const s of manifest.skills) all.push(typeof s === 'string' ? s : s.name);
        }
        expect(all.length).toBe(44);
        expect(new Set(all).size).toBe(44);
    });

    it('processes.json has been removed', () => {
        expect(fs.existsSync(path.join(CONTENT, 'processes.json'))).toBe(false);
    });
});
