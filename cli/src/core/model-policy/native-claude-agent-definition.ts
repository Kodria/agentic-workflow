import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { secureFs } from '../secure-fs/native-bridge';

export type ClaudeAgentDeclaration = { agentType: string; modelId: string };
const observedDeclarations = new WeakMap<object, string>();
export function isNativeClaudeAgentDeclaration(value: unknown): value is ClaudeAgentDeclaration {
    return !!value && typeof value === 'object' && observedDeclarations.get(value) === JSON.stringify(value);
}

function safeDirectory(dir: string): void {
    for (let current = dir; ; current = path.dirname(current)) {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Claude agent definition has an unsafe ancestor');
        if (current === path.dirname(current)) break;
    }
}

/** An explicit custom-agent model is necessary, but the effective model must
 * still be independently observed in the native child transcript. Built-in
 * agents, aliases and an inherited/default model cannot enroll a selection. */
export function readClaudeAgentDeclaredModel(input: { cwd: string; configDir: string; agentType: string }): ClaudeAgentDeclaration {
    if (!input || typeof input !== 'object' || !path.isAbsolute(input.cwd) || !path.isAbsolute(input.configDir)
        || path.normalize(input.cwd) !== input.cwd || path.normalize(input.configDir) !== input.configDir
        || input.cwd.includes('\0') || input.configDir.includes('\0')
        || typeof input.agentType !== 'string' || !/^awm-[A-Za-z0-9][A-Za-z0-9_-]{0,123}$/.test(input.agentType))
        throw new Error('Claude agent definition identity is invalid');
    const dirs = [path.join(input.configDir, 'agents'), path.join(input.cwd, '.claude', 'agents')];
    const declared: string[] = [];
    for (const dir of dirs) {
        try { safeDirectory(dir); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        const names = fs.readdirSync(dir).filter(name => name.endsWith('.md'));
        if (names.length > 256) throw new Error('Claude agent definitions exceed limit');
        for (const name of names) {
            const file = path.join(dir, name);
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Claude agent definition is unsafe');
            const bytes = secureFs.readRegularFile(file, 1024 * 1024).bytes;
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
            if (!match) continue;
            let frontmatter: unknown;
            try { frontmatter = yaml.load(match[1]); }
            catch { throw new Error('Claude agent frontmatter is invalid'); }
            if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) continue;
            const row = frontmatter as Record<string, unknown>;
            if (row.name !== input.agentType) continue;
            if (typeof row.description !== 'string' || !row.description.trim()) throw new Error('Claude agent description is missing');
            if (typeof row.model !== 'string' || !/^claude-[a-z0-9][a-z0-9.-]{1,126}$/.test(row.model))
                throw new Error('Claude agent requires an explicit full model ID; aliases and inherit are unverified');
            declared.push(row.model);
        }
    }
    if (declared.length !== 1) throw new Error(declared.length ? 'Claude agent definition is ambiguous' : 'Claude agent has no explicit custom definition');
    const result = { agentType: input.agentType, modelId: declared[0] };
    observedDeclarations.set(result, JSON.stringify(result));
    return result;
}
