import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BundleDefinition } from '../../../src/core/bundles';

function bundle(name: string, scope: BundleDefinition['scope'], skills: string[]): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: skills.map((s) => ({ name: s, onSignal: false })),
        workflows: [], agents: [],
    };
}

describe('gatherContext', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    // Crea un symlink "vivo" <claudeSkills>/<skill> → un target real.
    function linkGlobalSkill(skill: string) {
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const target = path.join(tmpHome, 'targets', skill);
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(skillsDir, skill), 'dir');
    }

    it('machine: cli/hook/devCore absent on a bare HOME', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.cliSource.present).toBe(false);
        expect(ctx.machine.hook.present).toBe(false);
        expect(ctx.machine.devCore.present).toBe(false);
        expect(ctx.machine.ambient.wanted).toEqual([]);
    });

    it('machine: devCore present when baseline skills are linked globally', () => {
        linkGlobalSkill('brainstorming');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.devCore.present).toBe(true);
        expect(ctx.machine.devCore.brokenLinks).toEqual([]);
    });

    it('machine: reports a broken dev-core symlink', () => {
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.symlinkSync(path.join(tmpHome, 'targets', 'gone'), path.join(skillsDir, 'brainstorming'), 'dir');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.devCore.present).toBe(false);
        expect(ctx.machine.devCore.brokenLinks).toContain('brainstorming');
    });

    it('machine: ambient wanted read from ~/.awm/config.json, installed reflects links', () => {
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'config.json'), JSON.stringify({ ambient: ['personal-notion'] }));
        linkGlobalSkill('notion-skill');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const bundles = [
            bundle('dev-core', 'baseline', ['brainstorming']),
            bundle('personal-notion', 'ambient', ['notion-skill']),
        ];
        const ctx = gatherContext({ cwd: tmpHome, bundles });
        expect(ctx.machine.ambient.wanted).toEqual(['personal-notion']);
        expect(ctx.machine.ambient.installed).toEqual(['personal-notion']);
    });

    it('project: null when cwd has no project root', () => {
        // tmpHome is bare (no .git / package.json / .awm/profile.json)
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [] });
        expect(ctx.project).toBeNull();
    });

    it('project: maps profile, activation, sensors, constitution and context', () => {
        const root = path.join(tmpHome, 'repo');
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}'); // project root marker
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), JSON.stringify({ extensions: ['frontend'] }));
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{}');
        fs.writeFileSync(path.join(root, 'CONSTITUTION.md'), '# rules');
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents');
        // link the expected project skill locally
        const localSkills = path.join(root, '.claude', 'skills');
        fs.mkdirSync(localSkills, { recursive: true });
        const target = path.join(root, 'targets', 'frontend-craft');
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(localSkills, 'frontend-craft'), 'dir');

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: root, bundles: [bundle('frontend', 'project', ['frontend-craft'])] });

        expect(ctx.project).not.toBeNull();
        expect(ctx.project.profile).toEqual({ present: true, extensions: ['frontend'] });
        expect(ctx.project.activeBundles.expected).toEqual(['frontend-craft']);
        expect(ctx.project.activeBundles.linked).toEqual(['frontend-craft']);
        expect(ctx.project.activeBundles.broken).toEqual([]);
        expect(ctx.project.sensors.present).toBe(true);
        expect(ctx.project.constitution.present).toBe(true);
        expect(ctx.project.context).toEqual({ present: true, file: 'AGENTS.md' });
    });

    it('project: context prefers CLAUDE.md over AGENTS.md', () => {
        const root = path.join(tmpHome, 'repo2');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# claude');
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: root, bundles: [] });
        expect(ctx.project.context).toEqual({ present: true, file: 'CLAUDE.md' });
    });
});
