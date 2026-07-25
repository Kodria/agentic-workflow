import fs from 'fs';
import os from 'os';
import path from 'path';

describe('agent command — listAgents / disableAgent', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-agentcmd-'));
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

    function prefsWith(enabledAgents: string[], defaultAgent: string) {
        const { savePreferences } = require('../../src/utils/config');
        savePreferences({
            defaultAgent,
            enabledAgents,
            installMethod: 'symlink',
            defaultScope: 'local',
        });
    }

    function writePrefs(enabledAgents: string[], defaultAgent: string) {
        prefsWith(enabledAgents, defaultAgent);
    }

    function readPrefs() {
        const file = path.join(process.env.AWM_HOME as string, 'preferences.json');
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }

    it('lists supported, enabled and default state', () => {
        writePrefs(['claude-code', 'codex'], 'claude-code');
        const { listAgents } = require('../../src/commands/agent');
        expect(listAgents()).toEqual(expect.arrayContaining([
            { id: 'claude-code', label: 'Claude Code', enabled: true, default: true },
            { id: 'codex', label: 'Codex', enabled: true, default: false },
            { id: 'opencode', label: 'OpenCode', enabled: false, default: false },
        ]));
    });

    it('refuses to disable the default without a replacement', () => {
        writePrefs(['claude-code', 'codex'], 'claude-code');
        const { disableAgent } = require('../../src/commands/agent');
        expect(() => disableAgent('claude-code')).toThrow('--default <agent>');
    });

    it('disables management state without deleting provider files', () => {
        const marker = path.join(tmpHome, '.codex/AGENTS.md');
        fs.mkdirSync(path.dirname(marker), { recursive: true });
        fs.writeFileSync(marker, 'keep');
        writePrefs(['claude-code', 'codex'], 'claude-code');

        const { disableAgent } = require('../../src/commands/agent');
        disableAgent('codex');

        expect(readPrefs().enabledAgents).toEqual(['claude-code']);
        expect(fs.readFileSync(marker, 'utf8')).toBe('keep');
    });

    it('disabling the default WITH a valid replacement succeeds and switches the default', () => {
        writePrefs(['claude-code', 'codex'], 'claude-code');
        const { disableAgent } = require('../../src/commands/agent');
        disableAgent('claude-code', 'codex');
        expect(readPrefs()).toEqual({
            defaultAgent: 'codex',
            enabledAgents: ['codex'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });
    });

    it('rejects a replacement default that is not itself enabled', () => {
        writePrefs(['claude-code', 'codex'], 'claude-code');
        const { disableAgent } = require('../../src/commands/agent');
        expect(() => disableAgent('claude-code', 'opencode')).toThrow('must remain enabled');
    });

    it('rejects disabling an agent that is not enabled', () => {
        writePrefs(['claude-code'], 'claude-code');
        const { disableAgent } = require('../../src/commands/agent');
        expect(() => disableAgent('codex')).toThrow('is not enabled');
    });

    it('registers `agent list` and `agent disable` subcommands', () => {
        const { Command } = require('commander');
        const { registerAgentCommand } = require('../../src/commands/agent');
        const program = new Command();
        registerAgentCommand(program);
        const agent = program.commands.find((c: any) => c.name() === 'agent');
        expect(agent).toBeDefined();
        const subNames = agent.commands.map((c: any) => c.name());
        expect(subNames).toEqual(expect.arrayContaining(['list', 'disable']));
    });
});
