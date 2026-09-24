import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { approvePolicy } from '../../../src/core/model-policy/store';
import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { ensureMachineKey } from '../../../src/core/model-policy/machine-key';
import { readStoredEventReceipt } from '../../../src/core/model-policy/event-store';

describe('Claude hook to event receipt integration', () => {
    it('captures a real-format hook pair and assistant trace without paid inference', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-hook-flow-'));
        const previous = { home: process.env.HOME, awm: process.env.AWM_HOME, config: process.env.CLAUDE_CONFIG_DIR };
        const awmHome = path.join(root, 'awm'); const project = path.join(root, 'project'); const configDir = path.join(root, 'claude'); const bin = path.join(root, 'bin');
        fs.mkdirSync(awmHome); fs.mkdirSync(project); fs.mkdirSync(configDir); fs.mkdirSync(bin);
        process.env.HOME = root; process.env.AWM_HOME = awmHome; process.env.CLAUDE_CONFIG_DIR = configDir;
        try {
            ensureMachineKey(awmHome);
            const selected = { selector: { kind: 'model' as const, id: 'claude-sonnet-4-6' }, effort: { kind: 'runtime-default' as const } };
            const content = { schema: 'model-policy/v1' as const, mappings: [{ target: 'claude-code' as const, runtimeKind: 'native',
                profiles: { mechanical: selected, integration: selected, judgment: selected }, fullCapability: selected,
                degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } }],
                implementationBudget: { maxAttempts: 3 as const, escalation: ['mechanical', 'integration', 'judgment'] as ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] as ['medium', 'high'] } };
            fs.writeFileSync(path.join(project, 'candidate.json'), JSON.stringify(content));
            approvePolicy({ file: 'candidate.json', scope: 'project', cwd: project, expectedDigest: canonicalPolicyDigest(content) });
            const executable = path.join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude');
            const authResponse = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'anthropic', email: 'test@example.invalid', orgId: 'org-test' };
            let preload: string | undefined;
            if (process.platform === 'win32') {
                // A Unix shebang cannot be launched by CreateProcess. Use a real
                // .exe and intercept only its auth-status invocation in Node.
                fs.copyFileSync(process.execPath, executable);
                preload = path.join(root, 'claude-preload.cjs');
                fs.writeFileSync(preload, `if (require('path').basename(process.execPath).toLowerCase() === 'claude.exe' && process.argv[1] === 'auth') { process.stdout.write(${JSON.stringify(JSON.stringify(authResponse))}); process.exit(0); }\n`);
            } else {
                fs.writeFileSync(executable, `#!${process.execPath}\nif (process.argv[2] === '--version') process.stdout.write('2.1.263\\n');\nelse if (process.argv[2] === 'auth') process.stdout.write(${JSON.stringify(JSON.stringify(authResponse))});\n`, { mode: 0o755 });
            }
            const timestamp = new Date().toISOString();
            const transcript = path.join(configDir, 'projects', 'p', 's', 'subagents', 'agent-agent-1.jsonl');
            fs.mkdirSync(path.dirname(transcript), { recursive: true });
            fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', timestamp, message: { model: 'claude-sonnet-4-6', content: [] } })}\n`);
            fs.mkdirSync(path.join(configDir, 'agents'));
            fs.writeFileSync(path.join(configDir, 'agents', 'awm-integration.md'), '---\nname: awm-integration\ndescription: AWM integration agent\nmodel: claude-sonnet-4-6\n---\nPerform integration work.\n');
            const start = { hook_event_name: 'SubagentStart', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'awm-integration' };
            const stop = { ...start, hook_event_name: 'SubagentStop', agent_transcript_path: transcript, stop_hook_active: false };
            const cli = path.resolve(__dirname, '../../../dist/src/index.js');
            const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
            if (preload) env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${JSON.stringify(preload)}`;
            const first = spawnSync(process.execPath, [cli, 'model-policy', 'hook-event', '--event', 'start', '--cwd', project], { cwd: project, env, input: JSON.stringify(start), encoding: 'utf8' });
            expect(first.status).toBe(0); expect(first.stdout).toBe('');
            const second = spawnSync(process.execPath, [cli, 'model-policy', 'hook-event', '--event', 'stop', '--cwd', project], { cwd: project, env, input: JSON.stringify(stop), encoding: 'utf8' });
            expect(second.status).toBe(0); expect(second.stdout).toBe(''); expect(second.stderr).toBe('');
            const files = fs.readdirSync(path.join(awmHome, 'routing-capabilities-v2', 'claude-code'));
            expect(files).toEqual(['native.json']);
            const raw = fs.readFileSync(path.join(awmHome, 'routing-capabilities-v2', 'claude-code', 'native.json'), 'utf8');
            expect(raw).not.toContain('test@example.invalid');
            const persisted = JSON.parse(raw);
            expect(readStoredEventReceipt(persisted.receipt.runtime)).toMatchObject({ state: 'present', receipt: { claims: [expect.objectContaining({ selection: selected, nativeAgentType: 'awm-integration', actualModel: expect.objectContaining({ id: 'claude-sonnet-4-6' }), tokenUsage: 'unknown' })] } });
            const generic = { ...start, agent_id: 'other-agent', agent_type: 'general-purpose' };
            const ignored = spawnSync(process.execPath, [cli, 'model-policy', 'hook-event', '--event', 'start', '--cwd', project, '--json'], { cwd: project, env, input: JSON.stringify(generic), encoding: 'utf8' });
            expect(ignored.status).toBe(0); expect(JSON.parse(ignored.stdout)).toMatchObject({ state: 'ignored' });
            expect(fs.readFileSync(path.join(awmHome, 'routing-capabilities-v2', 'claude-code', 'native.json'), 'utf8')).toBe(raw);
        } finally {
            if (previous.home === undefined) delete process.env.HOME; else process.env.HOME = previous.home;
            if (previous.awm === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous.awm;
            if (previous.config === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous.config;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
