import { createHash, createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';
import { secureFs } from '../secure-fs/native-bridge';
import { parseJsonNoDuplicate } from '../plan/json';

const MODEL_KEYS = ['model', 'effortLevel', 'availableModels', 'enforceAvailableModels', 'modelOverrides'];
const ENV_KEYS = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE'];

function safeDirectory(dir: string): void {
    for (let current = dir; ; current = path.dirname(current)) {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Claude settings have an unsafe or symlinked ancestor');
        if (current === path.dirname(current)) break;
    }
}

function settings(file: string): Record<string, unknown> | null {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    safeDirectory(path.dirname(file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Claude settings file is unsafe or symlinked');
    const bytes = secureFs.readRegularFile(file, 1024 * 1024).bytes;
    const value = parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Claude settings must be an object');
    return value as Record<string, unknown>;
}

function agentDefinitions(dir: string): Array<[string, string]> {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    safeDirectory(path.dirname(dir));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Claude agents directory is unsafe or symlinked');
    const names = fs.readdirSync(dir).filter(name => name.endsWith('.md')).sort();
    if (names.length > 256) throw new Error('Claude agent definitions exceed limit');
    return names.map(name => {
        const file = path.join(dir, name);
        const entry = fs.lstatSync(file);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Claude agent definition is unsafe or symlinked');
        const bytes = secureFs.readRegularFile(file, 1024 * 1024).bytes;
        return [name, createHash('sha256').update(bytes).digest('hex')];
    });
}

/** Fingerprints only locally visible model controls. Managed/server-side policy
 * is not represented here; a native child observation remains mandatory. */
export function readClaudeModelConfigDigest(input: { cwd: string; configDir: string; key: Buffer; environment: Record<string, string | undefined> }): string {
    if (!input || typeof input !== 'object' || !path.isAbsolute(input.cwd) || !path.isAbsolute(input.configDir)
        || path.normalize(input.cwd) !== input.cwd || path.normalize(input.configDir) !== input.configDir
        || input.cwd.includes('\0') || input.configDir.includes('\0') || !Buffer.isBuffer(input.key) || input.key.length !== 32
        || !input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment)) throw new Error('Claude model config input is invalid');
    safeDirectory(input.cwd);
    safeDirectory(input.configDir);
    const files = [path.join(input.configDir, 'settings.json'), path.join(input.cwd, '.claude', 'settings.json'), path.join(input.cwd, '.claude', 'settings.local.json')];
    const projection = files.map(file => {
        const value = settings(file);
        if (!value) return null;
        const model: Record<string, unknown> = {};
        for (const key of MODEL_KEYS) if (Object.prototype.hasOwnProperty.call(value, key)) model[key] = value[key];
        if (value.env && typeof value.env === 'object' && !Array.isArray(value.env)) {
            const env: Record<string, unknown> = {};
            for (const key of ENV_KEYS) if (Object.prototype.hasOwnProperty.call(value.env, key)) env[key] = (value.env as Record<string, unknown>)[key];
            if (Object.keys(env).length) model.env = env;
        }
        return model;
    });
    const environment: Record<string, string> = {};
    for (const key of ENV_KEYS) {
        const value = input.environment[key];
        if (value !== undefined) {
            if (typeof value !== 'string' || value.length > 4096) throw new Error('Claude model environment is invalid');
            environment[key] = value;
        }
    }
    const agents = [agentDefinitions(path.join(input.configDir, 'agents')), agentDefinitions(path.join(input.cwd, '.claude', 'agents'))];
    return createHmac('sha256', input.key).update(JSON.stringify({ projection, agents, environment })).digest('hex');
}
