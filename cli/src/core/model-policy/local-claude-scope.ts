import os from 'os';
import path from 'path';
import { awmHome } from '../paths';
import type { EventScope } from './capabilities-v2';
import { readMachineKey } from './machine-key';
import { queryClaudeAuthStatus } from './native-claude-machine';
import { readClaudeModelConfigDigest } from './native-claude-config';
import { queryRuntimeExecutable } from './native-runtime';
import { readRoutingHookStatus } from './hook-diagnostics';

export type LocalClaudeScope = { state: 'current'; scope: EventScope } | { state: 'unverified'; reason: 'MACHINE_KEY_MISSING' | 'ACCOUNT_UNVERIFIED' | 'NATIVE_QUERY_FAILED' | 'HOOK_CAPTURE_FAILED' };
export interface LocalClaudeScopeDeps {
    /** Native stop capture can recover an earlier diagnostic; dispatch cannot. */
    requireHookHealthy?: boolean;
    readRoutingHookStatus?: typeof readRoutingHookStatus;
    readMachineKey?: typeof readMachineKey;
    queryClaudeAuthStatus?: typeof queryClaudeAuthStatus;
    queryRuntimeExecutable?: typeof queryRuntimeExecutable;
    readClaudeModelConfigDigest?: typeof readClaudeModelConfigDigest;
}

/** Read-only local facts; no model inference or machine-key creation. */
export async function queryLocalClaudeScope(cwd: string, runtimeKind: string, deps: LocalClaudeScopeDeps = {}): Promise<LocalClaudeScope> {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0') || typeof runtimeKind !== 'string'
        || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(runtimeKind)) throw new Error('local Claude scope input is invalid');
    const hooks = (deps.readRoutingHookStatus ?? readRoutingHookStatus)();
    if (deps.requireHookHealthy !== false && (hooks.state === 'failed' || hooks.state === 'invalid')) return { state: 'unverified', reason: 'HOOK_CAPTURE_FAILED' };
    const key = (deps.readMachineKey ?? readMachineKey)(awmHome());
    if (!key) return { state: 'unverified', reason: 'MACHINE_KEY_MISSING' };
    try {
        const [auth, runtime] = await Promise.all([
            (deps.queryClaudeAuthStatus ?? queryClaudeAuthStatus)({ command: 'claude', args: ['auth', 'status'], timeoutMs: 10000, key }),
            (deps.queryRuntimeExecutable ?? queryRuntimeExecutable)({ command: 'claude', args: ['--version'], timeoutMs: 10000 }),
        ]);
        if (auth.accountState !== 'identified' || !auth.accountScopeDigest) return { state: 'unverified', reason: 'ACCOUNT_UNVERIFIED' };
        const configDigest = (deps.readClaudeModelConfigDigest ?? readClaudeModelConfigDigest)({ cwd, configDir: path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')),
            key, environment: process.env });
        return { state: 'current', scope: { runtime: { target: 'claude-code', kind: runtimeKind, version: runtime.version,
            accountScopeDigest: auth.accountScopeDigest }, binaryDigest: runtime.binaryDigest, configDigest } };
    } catch { return { state: 'unverified', reason: 'NATIVE_QUERY_FAILED' }; }
}
