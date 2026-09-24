import { createHmac } from 'crypto';
import { spawn } from 'child_process';

export type ClaudeAuthFacts = { provenance: 'claude-auth-status'; accountState: 'identified' | 'unverified'; accountScopeDigest: string | null; inferenceDispatched: false };
export type ClaudeAuthQuery = { command: string; args: string[]; timeoutMs: number; key: Buffer };

/** `claude auth status` is documented as a JSON, no-inference command. The
 * account shape varies by auth method; incomplete identity stays unverified. */
export function queryClaudeAuthStatus(input: ClaudeAuthQuery): Promise<ClaudeAuthFacts> {
    if (!input || typeof input !== 'object' || typeof input.command !== 'string' || input.command.length === 0 || input.command.length > 4096
        || !Array.isArray(input.args) || input.args.length > 16 || input.args.some(value => typeof value !== 'string' || value.length > 65536)
        || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000
        || !Buffer.isBuffer(input.key) || input.key.length !== 32) throw new Error('Claude auth query is invalid');
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
        let settled = false;
        let buffer = '';
        const finish = (error?: Error, facts?: ClaudeAuthFacts): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) { child.kill(); reject(error); } else resolve(facts!);
        };
        const timer = setTimeout(() => finish(new Error('Claude auth status timed out')), input.timeoutMs);
        child.on('error', () => finish(new Error('Claude CLI could not be started')));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { buffer += chunk; if (buffer.length > 64 * 1024) finish(new Error('Claude auth status exceeds 64 KiB')); });
        child.on('exit', code => {
            if (code !== 0) return finish(new Error('Claude auth status failed or is logged out'));
            try {
                const parsed = JSON.parse(buffer) as unknown;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
                const value = parsed as Record<string, unknown>;
                if (value.loggedIn !== true) throw new Error('login');
                const fields = ['authMethod', 'apiProvider', 'email', 'orgId'] as const;
                const identified = fields.every(field => typeof value[field] === 'string' && (value[field] as string).length > 0 && (value[field] as string).length <= 320);
                const subscriptionType = value.subscriptionType;
                if (subscriptionType !== null && subscriptionType !== undefined && (typeof subscriptionType !== 'string' || subscriptionType.length > 128)) throw new Error('subscription');
                const accountScopeDigest = identified ? createHmac('sha256', input.key).update(JSON.stringify(fields.map(field => value[field]).concat([subscriptionType ?? null]))).digest('hex') : null;
                finish(undefined, { provenance: 'claude-auth-status', accountState: accountScopeDigest ? 'identified' : 'unverified', accountScopeDigest, inferenceDispatched: false });
            } catch { finish(new Error('Claude auth status response is invalid')); }
        });
    });
}
