import { createHash } from 'crypto';
import { Command } from 'commander';
import { AGENT_TARGETS } from '../../providers';
import { approvePolicy, readEffectivePolicy, type ApprovePolicyInput } from '../../core/model-policy/store';
import { MAX_MAPPINGS, MAX_POLICY_BYTES, assertDigest } from '../../core/model-policy/validate';
import { approveCapabilities, readCapabilities, type ApproveCapabilitiesInput } from '../../core/model-policy/capabilities';

const roles = ['implementer', 'specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'architecture', 'track-a-qa', 'track-b-qa', 'controller', 'documentation', 'retro', 'finishing'];
const implementerProfiles = ['mechanical', 'integration', 'judgment'];
const contract = { schema: 'routing-protocol/v1', supportedPlanSchemas: ['compact-slices/v1', 'compact-slices/v2'], roles, implementerProfiles, limits: { maxFileBytes: MAX_POLICY_BYTES, maxMappings: MAX_MAPPINGS, maxIdentifierChars: 128, maxDiagnostics: 20, maxDiagnosticChars: 4096 } };
const protocolDigest = createHash('sha256').update(JSON.stringify(contract), 'utf8').digest('hex');

export interface ModelPolicyCommandDependencies { approvePolicy?: (input: ApprovePolicyInput) => ReturnType<typeof approvePolicy>; readEffectivePolicy?: typeof readEffectivePolicy; approveCapabilities?: (input: ApproveCapabilitiesInput) => ReturnType<typeof approveCapabilities>; readCapabilities?: typeof readCapabilities; }
function text(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || value.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`${label} requires a non-empty value without control characters`); }
function output(value: unknown, json: boolean): void { process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`); }

export function registerModelPolicyCommand(program: Command, deps: ModelPolicyCommandDependencies = {}): void {
    if (!program || typeof program.command !== 'function') throw new Error('program must be a Commander command');
    const approve = deps.approvePolicy ?? approvePolicy; const read = deps.readEffectivePolicy ?? readEffectivePolicy; const approveReceipt = deps.approveCapabilities ?? approveCapabilities; const readReceipt = deps.readCapabilities ?? readCapabilities;
    const command = program.command('model-policy').description('inspect and explicitly approve portable routing policy');
    command.command('contract').option('--cwd <path>').option('--json').action((options: { cwd?: string; json?: boolean }) => { if (options.cwd !== undefined) text(options.cwd, '--cwd'); output({ ...contract, protocolDigest }, options.json === true); });
    command.command('approve').requiredOption('--file <path>').requiredOption('--scope <scope>').requiredOption('--expected-digest <sha>').option('--replace-digest <sha>').option('--cwd <path>').option('--json').action((options: { file: string; scope: string; expectedDigest: string; replaceDigest?: string; cwd?: string; json?: boolean }) => {
        text(options.file, '--file'); text(options.scope, '--scope'); text(options.expectedDigest, '--expected-digest'); if (options.cwd !== undefined) text(options.cwd, '--cwd'); if (options.replaceDigest !== undefined) text(options.replaceDigest, '--replace-digest'); assertDigest(options.expectedDigest, 'expectedDigest'); if (options.replaceDigest !== undefined) assertDigest(options.replaceDigest, 'replaceDigest');
        const policy = approve({ file: options.file, scope: options.scope as 'user' | 'project', cwd: options.cwd ?? process.cwd(), expectedDigest: options.expectedDigest, replaceDigest: options.replaceDigest }); output({ state: 'approved', policy }, options.json === true);
    });
    command.command('capabilities approve').requiredOption('--file <path>').requiredOption('--expected-digest <sha>').option('--replace-digest <sha>').option('--cwd <path>').option('--json').action((options: { file: string; expectedDigest: string; replaceDigest?: string; cwd?: string; json?: boolean }) => {
        text(options.file, '--file'); text(options.expectedDigest, '--expected-digest'); if (options.replaceDigest !== undefined) text(options.replaceDigest, '--replace-digest'); if (options.cwd !== undefined) text(options.cwd, '--cwd'); assertDigest(options.expectedDigest, 'expectedDigest'); if (options.replaceDigest) assertDigest(options.replaceDigest, 'replaceDigest');
        output({ state: 'approved', receipt: approveReceipt({ file: options.file, cwd: options.cwd ?? process.cwd(), expectedDigest: options.expectedDigest, replaceDigest: options.replaceDigest }) }, options.json === true);
    });
    command.command('status').requiredOption('--provider <target>').requiredOption('--runtime-kind <kind>').requiredOption('--runtime-version <version>').requiredOption('--account-scope-digest <sha>').option('--cwd <path>').option('--json').action((options: { provider: string; runtimeKind: string; runtimeVersion: string; accountScopeDigest: string; cwd?: string; json?: boolean }) => {
        text(options.provider, '--provider'); text(options.runtimeKind, '--runtime-kind'); text(options.runtimeVersion, '--runtime-version'); text(options.accountScopeDigest, '--account-scope-digest'); if (options.cwd !== undefined) text(options.cwd, '--cwd'); if (!(AGENT_TARGETS as readonly string[]).includes(options.provider)) throw new Error('--provider is invalid'); if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(options.runtimeKind)) throw new Error('--runtime-kind is invalid'); if (!/^\d+\.\d+\.\d+$/.test(options.runtimeVersion)) throw new Error('--runtime-version must be numeric semver'); assertDigest(options.accountScopeDigest, 'accountScopeDigest');
        const cwd = options.cwd ?? process.cwd(); const effective = read(cwd); const capability = readReceipt({ target: options.provider as any, kind: options.runtimeKind, version: options.runtimeVersion, accountScopeDigest: options.accountScopeDigest }, new Date()); output({ policy: effective, capability }, options.json === true); if (effective.state !== 'approved' || capability.state !== 'current') process.exitCode = 2;
    });
}
