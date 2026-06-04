import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectExtensions } from '../../../src/core/init/detector';

function tmpRepo(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-detector-'));
}

describe('detectExtensions', () => {
    let root: string;
    beforeEach(() => { root = tmpRepo(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('proposes frontend when package.json has a frontend dep', () => {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
        const r = detectExtensions(root);
        expect(r.proposed).toContain('frontend');
        expect(r.signals.some((s) => s.includes('next'))).toBe(true);
    });

    it('does NOT propose docs for a lone README', () => {
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'README.md'), '# readme');
        expect(detectExtensions(root).proposed).not.toContain('docs');
    });

    it('proposes docs when a docs config is present', () => {
        fs.writeFileSync(path.join(root, 'mkdocs.yml'), 'site_name: x');
        expect(detectExtensions(root).proposed).toContain('docs');
    });

    it('proposes docs when docs/ has 2+ markdown files', () => {
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# a');
        fs.writeFileSync(path.join(root, 'docs', 'b.md'), '# b');
        expect(detectExtensions(root).proposed).toContain('docs');
    });

    it('proposes nothing for a backend-only repo', () => {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { express: '4.0.0' } }));
        const r = detectExtensions(root);
        expect(r.proposed).toEqual([]);
        expect(r.deferred).toEqual([]);
    });

    it('defers infra signals (no bundle yet)', () => {
        fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM node');
        const r = detectExtensions(root);
        expect(r.proposed).toEqual([]);
        expect(r.deferred.some((d) => d.includes('infra'))).toBe(true);
    });

    it('proposes both for a combined repo (Next + real docs)', () => {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { astro: '4.0.0' } }));
        fs.writeFileSync(path.join(root, 'docusaurus.config.js'), 'module.exports = {}');
        const r = detectExtensions(root);
        expect(r.proposed).toEqual(expect.arrayContaining(['frontend', 'docs']));
    });
});
