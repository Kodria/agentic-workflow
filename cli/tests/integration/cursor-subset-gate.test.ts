/**
 * Plan B R3.1 — seven non-empty subsets of {claude-code, codex, cursor}.
 * Isolated HOME/AWM_HOME; no real ~/.claude or ~/.codex required for {cursor}.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentTarget } from '../../src/providers';

const TRIO: AgentTarget[] = ['claude-code', 'codex', 'cursor'];

function subsetsOf(agents: AgentTarget[]): AgentTarget[][] {
    const out: AgentTarget[][] = [];
    for (let mask = 1; mask < (1 << agents.length); mask++) {
        out.push(agents.filter((_, i) => (mask & (1 << i)) !== 0));
    }
    return out;
}

describe('Cursor subset gate (Plan B R3.1)', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-subset-home-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-subset-reg-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-subset-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();

        const skill = path.join(tmpRegistry, 'skills/using-awm');
        fs.mkdirSync(skill, { recursive: true });
        fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: using-awm\ndescription: guide\n---\nMUST invoke skills.\n');
        const hooks = path.join(tmpRegistry, 'hooks');
        fs.mkdirSync(hooks, { recursive: true });
        for (const name of ['cursor-session-start', 'cursor-pre-compact', 'cursor-post-tool-use', 'codex-session-start', 'session-start', 'run-hook.cmd']) {
            fs.writeFileSync(path.join(hooks, name), '#!/usr/bin/env node\nconsole.log("{}")\n', { mode: 0o755 });
        }
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm/preferences.json'), JSON.stringify({
            defaultAgent: 'cursor',
            enabledAgents: TRIO,
            installMethod: 'symlink',
            defaultScope: 'local',
        }));
        fs.writeFileSync(path.join(tmpHome, '.awm/registries.json'), JSON.stringify([
            { name: 'baseline', remote: 'https://example.invalid/baseline.git' },
        ]));
        // Point baseline content root at our temp registry via junction/symlink of registries/baseline
        fs.mkdirSync(path.join(tmpHome, '.awm/registries'), { recursive: true });
        fs.symlinkSync(tmpRegistry, path.join(tmpHome, '.awm/registries/baseline'), process.platform === 'win32' ? 'junction' : 'dir');
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRegistry, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it.each(subsetsOf(TRIO).map((s) => [s.join('+'), s] as const))(
        'subset %s installs a single using-awm skill delivery and Cursor hooks when included',
        (_label, subset) => {
            const { planInstall } = require('../../src/core/install-planner');
            const { applyInstallPlan } = require('../../src/core/install-transaction');
            const { installHook } = require('../../src/commands/hooks/install');
            const { providerFor } = require('../../src/providers');

            const skillSource = path.join(tmpRegistry, 'skills/using-awm');
            const plan = planInstall({
                artifacts: [{
                    name: 'using-awm',
                    installName: 'using-awm',
                    type: 'skill',
                    sourcePath: skillSource,
                }],
                selectedAgents: subset,
                enabledAgents: subset,
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            applyInstallPlan(plan);

            // Shared agents skills root (Cursor/Codex/OpenCode) — at most one using-awm.
            // Claude may also have ~/.claude/skills/using-awm; that is a separate channel.
            const sharedRoot = path.join(tmpHome, '.agents/skills');
            const sharedSkill = path.join(sharedRoot, 'using-awm');
            const wantsShared = subset.some((agent) => {
                const global = providerFor(agent).skill.global as string | null;
                return global === sharedRoot;
            });
            if (wantsShared) {
                expect(fs.existsSync(sharedSkill)).toBe(true);
            }
            expect(fs.existsSync(path.join(tmpHome, '.cursor/rules/using-awm.mdc'))).toBe(false);

            if (subset.includes('cursor')) {
                // {cursor} alone must not require ~/.claude or ~/.codex
                if (subset.length === 1) {
                    expect(fs.existsSync(path.join(tmpHome, '.claude'))).toBe(false);
                    expect(fs.existsSync(path.join(tmpHome, '.codex'))).toBe(false);
                }
                installHook({
                    agent: 'cursor',
                    registryRoot: tmpRegistry,
                    installMethod: 'copy',
                    baselineRegistryVersion: '4.9.0',
                });
                expect(fs.existsSync(path.join(tmpHome, '.awm/hooks/cursor/session-start'))).toBe(true);
                const hooksJson = JSON.parse(fs.readFileSync(path.join(tmpHome, '.cursor/hooks.json'), 'utf8'));
                expect(hooksJson.version).toBe(1);
                expect(hooksJson.hooks.sessionStart.some((e: { command: string }) => e.command.endsWith(`${path.sep}session-start`))).toBe(true);
                expect(hooksJson.hooks.preCompact.some((e: { command: string }) => e.command.endsWith(`${path.sep}pre-compact`))).toBe(true);
                expect(hooksJson.hooks.postToolUse.some((e: { command: string }) => e.command.endsWith(`${path.sep}post-tool-use`))).toBe(true);
            }
        },
    );
});
