import { createHmac } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';

export type CodexMachineFacts = {
    provenance: 'codex-app-server-config-account';
    configDigest: string;
    accountState: 'identified' | 'unverified';
    accountScopeDigest: string | null;
    inferenceDispatched: false;
};
export type CodexMachineQuery = { command: string; args: string[]; timeoutMs: number; cwd: string; key: Buffer };

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function canonical(value: unknown, depth = 0): string {
    if (depth > 32) throw new Error('Codex configuration nesting exceeds limit');
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
    const item = record(value, 'Codex configuration value');
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key], depth + 1)}`).join(',')}}`;
}
function digest(key: Buffer, value: string): string { return createHmac('sha256', key).update(value, 'utf8').digest('hex'); }

/** Explicit no-inference query. HMAC prevents offline guessing of email and
 * configuration values; the caller owns one stable per-machine key. */
export function queryCodexMachineFacts(input: CodexMachineQuery): Promise<CodexMachineFacts> {
    if (!input || typeof input !== 'object' || typeof input.command !== 'string' || input.command.length === 0 || input.command.length > 4096
        || !Array.isArray(input.args) || input.args.length > 16 || input.args.some(arg => typeof arg !== 'string' || arg.length > 65536)
        || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000
        || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || !Buffer.isBuffer(input.key) || input.key.length !== 32) throw new Error('Codex machine query is invalid');
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, cwd: input.cwd });
        let settled = false;
        let buffer = '';
        let expectedId = 1;
        let configDigest: string | undefined;
        const finish = (error?: Error, result?: CodexMachineFacts): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (error) reject(error);
            else resolve(result!);
        };
        const send = (request: unknown): void => { if (!settled) child.stdin.write(`${JSON.stringify(request)}\n`); };
        const timer = setTimeout(() => finish(new Error('Codex machine query timed out')), input.timeoutMs);
        child.on('error', () => finish(new Error('Codex app-server could not be started')));
        child.stdin.on('error', () => finish(new Error('Codex app-server input failed')));
        child.on('exit', () => finish(new Error('Codex app-server exited before machine response')));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            if (settled) return;
            buffer += chunk;
            if (buffer.length > 2 * 1024 * 1024) return finish(new Error('Codex machine response exceeds 2 MiB'));
            for (;;) {
                const end = buffer.indexOf('\n');
                if (end < 0 || settled) break;
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (!line) continue;
                let message: Record<string, unknown>;
                try { message = record(JSON.parse(line), 'Codex protocol response'); }
                catch { return finish(new Error('Codex protocol returned invalid JSON')); }
                if (message.id === undefined) continue;
                if (message.id !== expectedId) return finish(new Error('Codex protocol response id mismatch'));
                if (message.error !== undefined) return finish(new Error('Codex app-server rejected machine query'));
                try {
                    const result = record(message.result, 'Codex machine result');
                    if (expectedId === 1) {
                        expectedId = 2;
                        send({ method: 'initialized' });
                        send({ id: expectedId, method: 'config/read', params: { cwd: input.cwd, includeLayers: false } });
                    } else if (expectedId === 2) {
                        configDigest = digest(input.key, canonical(record(result.config, 'Codex effective config')));
                        expectedId = 3;
                        send({ id: expectedId, method: 'account/read', params: { refreshToken: false } });
                    } else {
                        if (typeof result.requiresOpenaiAuth !== 'boolean') throw new Error('Codex account response is invalid');
                        const account = result.account === null ? null : record(result.account, 'Codex account');
                        let accountScopeDigest: string | null = null;
                        if (account?.type === 'chatgpt' && typeof account.email === 'string' && account.email.length > 0 && account.email.length <= 320 && typeof account.planType === 'string') {
                            accountScopeDigest = digest(input.key, `chatgpt\0${account.email}\0${account.planType}`);
                        }
                        finish(undefined, { provenance: 'codex-app-server-config-account', configDigest: configDigest!,
                            accountState: accountScopeDigest ? 'identified' : 'unverified', accountScopeDigest, inferenceDispatched: false });
                    }
                } catch { finish(new Error('Codex machine response is invalid')); }
            }
        });
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'awm', title: 'AWM machine discovery', version: '1.0.0' } } });
    });
}
