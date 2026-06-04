import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundles } from '../../src/core/bundles';
import { installBundle, addBundle, syncProfile } from '../../src/core/bundle-install';
import { readProfile, writeProfile } from '../../src/core/profile';

/**
 * Builds a fixture with:
 *  - content registry: catalog + two project bundles (base, ext dependsOn base),
 *    plus a skill dir per skill, one workflow .md and one agent .md.
 *  - a separate empty project root for local installs.
 * Both bundles are `project` scope so every artifact lands under projectRoot/.claude.
 */
function makeFixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-binstall-'));
    const content = path.join(tmp, 'registry');
    const projectRoot = path.join(tmp, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });

    fs.mkdirSync(path.join(content, 'bundles', 'base'), { recursive: true });
    fs.mkdirSync(path.join(content, 'bundles', 'ext'), { recursive: true });
    // skill source dirs
    for (const s of ['s-base', 's-ext']) {
        fs.mkdirSync(path.join(content, 'skills', s), { recursive: true });
        fs.writeFileSync(path.join(content, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
    }
    // a workflow + agent source for `ext`
    fs.mkdirSync(path.join(content, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(content, 'workflows', 'wf-ext.md'), '# wf');
    fs.mkdirSync(path.join(content, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(content, 'agents', 'ag-ext.md'), '# agent');

    fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [
            { name: 'base', source: './bundles/base', version: '1.0.0', scope: 'project' },
            { name: 'ext', source: './bundles/ext', version: '1.0.0', scope: 'project' },
        ],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'base', 'bundle.json'), JSON.stringify({
        name: 'base', version: '1.0.0', description: 'Base', scope: 'project', dependsOn: [],
        skills: ['s-base'], workflows: [], agents: [],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'ext', 'bundle.json'), JSON.stringify({
        name: 'ext', version: '1.0.0', description: 'Ext', scope: 'project', dependsOn: ['base'],
        skills: ['s-ext'], workflows: ['wf-ext'], agents: ['ag-ext'],
    }));

    return { content, projectRoot, bundles: discoverBundles(content) };
}

describe('installBundle', () => {
    it('materializes the bundle closure as local symlinks (deps + own skills)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });

        const skillsDir = path.join(projectRoot, '.claude', 'skills');
        expect(fs.existsSync(path.join(skillsDir, 's-base'))).toBe(true); // from dep `base`
        expect(fs.existsSync(path.join(skillsDir, 's-ext'))).toBe(true);  // from `ext`
        expect(fs.lstatSync(path.join(skillsDir, 's-ext')).isSymbolicLink()).toBe(true);
        expect(result.installed.some((l) => l.includes('s-base'))).toBe(true);
    });

    it('installs supported artifact types and skips unsupported ones (claude-code workflows)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        // claude-code has no workflow dir → wf-ext is skipped; agents are supported.
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'agents', 'ag-ext.md'))).toBe(true);
        expect(result.skipped.some((l) => l.includes('wf-ext'))).toBe(true);
    });

    it('is idempotent: a second run leaves valid symlinks and does not throw', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const opts = {
            bundleName: 'ext', bundles, agents: ['claude-code' as const],
            method: 'symlink' as const, projectRoot, contentDir: content,
        };
        installBundle(opts);
        expect(() => installBundle(opts)).not.toThrow();
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });

    it('skips artifacts whose source is missing instead of throwing', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.rmSync(path.join(content, 'skills', 's-base'), { recursive: true, force: true });
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(result.skipped.some((l) => l.includes('s-base'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });
});

describe('addBundle', () => {
    it('records a project bundle installed locally as an extension + gitignores symlinks', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(result.recordedExtension).toBe('ext');
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
        const gi = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
        expect(gi).toContain('.claude/skills/');
    });

    it('does not record the dependency bundle, only the named one', () => {
        const { content, projectRoot, bundles } = makeFixture();
        addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(readProfile(projectRoot).extensions).toEqual(['ext']); // not ['base','ext']
    });

    it('is idempotent: adding the same bundle twice keeps one extension entry', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const opts = {
            bundleName: 'ext', bundles, agents: ['claude-code' as const],
            method: 'symlink' as const, projectRoot, contentDir: content,
        };
        addBundle(opts);
        addBundle(opts);
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
    });

    it('does not record extension when all sources are missing (nothing installed)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.rmSync(path.join(content, 'skills', 's-ext'), { recursive: true, force: true });
        fs.rmSync(path.join(content, 'skills', 's-base'), { recursive: true, force: true });
        fs.rmSync(path.join(content, 'agents', 'ag-ext.md'), { force: true });
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(result.recordedExtension).toBeNull();
        expect(readProfile(projectRoot).extensions).toEqual([]);
    });
});

describe('syncProfile', () => {
    it('rematerializes symlinks for every extension listed in the profile', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: ['ext'] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content,
        });
        expect(result.extensions).toEqual(['ext']);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-base'))).toBe(true);
    });

    it('is a no-op when the profile has no extensions', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: [] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content,
        });
        expect(result.extensions).toEqual([]);
        expect(result.installed).toEqual([]);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills'))).toBe(false);
    });
});
