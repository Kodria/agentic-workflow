import path from 'path';
import { awmHome } from '../paths';
import { readMachineKey } from './machine-key';
import { queryCodexMachineFacts } from './native-codex-machine';
import { queryRuntimeExecutable } from './native-runtime';
import type { EventScope } from './capabilities-v2';

export type LocalCodexScope = { state: 'current'; scope: EventScope } | { state: 'unverified'; reason: 'MACHINE_KEY_MISSING' | 'ACCOUNT_UNVERIFIED' | 'NATIVE_QUERY_FAILED' };
export interface LocalCodexScopeDeps {
    readMachineKey?: typeof readMachineKey;
    queryCodexMachineFacts?: typeof queryCodexMachineFacts;
    queryRuntimeExecutable?: typeof queryRuntimeExecutable;
}

/** Read-only, no-token local facts for the same cwd as the routed work. */
export async function queryLocalCodexScope(cwd: string, runtimeKind: string, deps: LocalCodexScopeDeps = {}): Promise<LocalCodexScope> {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0') || typeof runtimeKind !== 'string'
        || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(runtimeKind)) throw new Error('local Codex scope input is invalid');
    const key = (deps.readMachineKey ?? readMachineKey)(awmHome());
    if (!key) return { state: 'unverified', reason: 'MACHINE_KEY_MISSING' };
    try {
        const [machine, executable] = await Promise.all([
            (deps.queryCodexMachineFacts ?? queryCodexMachineFacts)({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000, cwd, key }),
            (deps.queryRuntimeExecutable ?? queryRuntimeExecutable)({ command: 'codex', args: ['--version'], timeoutMs: 10000 }),
        ]);
        if (machine.accountState !== 'identified' || !machine.accountScopeDigest) return { state: 'unverified', reason: 'ACCOUNT_UNVERIFIED' };
        return { state: 'current', scope: { runtime: { target: 'codex', kind: runtimeKind, version: executable.version,
            accountScopeDigest: machine.accountScopeDigest }, binaryDigest: executable.binaryDigest, configDigest: machine.configDigest } };
    } catch { return { state: 'unverified', reason: 'NATIVE_QUERY_FAILED' }; }
}
