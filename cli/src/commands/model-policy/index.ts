import { createHash } from 'crypto';
import { Command } from 'commander';
import os from 'os';
import path from 'path';
import { AGENT_TARGETS } from '../../providers';
import { approvePolicy, readEffectivePolicy, type ApprovePolicyInput } from '../../core/model-policy/store';
import { MAX_MAPPINGS, MAX_POLICY_BYTES, assertDigest } from '../../core/model-policy/validate';
import { approveCapabilities, readCapabilities, type ApproveCapabilitiesInput } from '../../core/model-policy/capabilities';
import { candidateDigest, type CandidateDigest, type CandidateDigestInput } from '../../core/model-policy/digest';
import { queryCodexChildThreadObservation, queryCodexModelCatalog } from '../../core/model-policy/native-codex';
import { queryCodexMachineFacts } from '../../core/model-policy/native-codex-machine';
import { queryRuntimeExecutable } from '../../core/model-policy/native-runtime';
import { queryClaudeAuthStatus } from '../../core/model-policy/native-claude-machine';
import { readClaudeModelConfigDigest } from '../../core/model-policy/native-claude-config';
import { ensureMachineKey } from '../../core/model-policy/machine-key';
import { publishCodexObservation, readStoredEventReceipt } from '../../core/model-policy/event-store';
import { evaluateEventReceipt } from '../../core/model-policy/capabilities-v2';
import { awmHome } from '../../core/paths';
import type { Selection } from '../../core/model-policy/types';
import { selectionPolicyDigest } from '../../core/model-policy/selection-policy-digest';
import { recordClaudeHookStart, readClaudeHookPair } from '../../core/model-policy/claude-hook-events';
import { readClaudeSubagentTranscript } from '../../core/model-policy/native-claude-transcript';
import { readClaudeAgentDeclaredModel } from '../../core/model-policy/native-claude-agent-definition';
import { publishClaudeObservation } from '../../core/model-policy/event-store';
import { queryLocalClaudeScope } from '../../core/model-policy/local-claude-scope';
import { parseJsonNoDuplicate } from '../../core/plan/json';
import { computeClaudeHookStatus } from '../hooks/claude';
import { readRoutingHookStatus, recordRoutingHookStatus } from '../../core/model-policy/hook-diagnostics';

const roles = ['implementer', 'specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'architecture', 'track-a-qa', 'track-b-qa', 'controller', 'documentation', 'retro', 'finishing'];
const implementerProfiles = ['mechanical', 'integration', 'judgment'];
const contract = { schema: 'routing-protocol/v1', supportedPlanSchemas: ['compact-slices/v1', 'compact-slices/v2'], roles, implementerProfiles, limits: { maxFileBytes: MAX_POLICY_BYTES, maxMappings: MAX_MAPPINGS, maxIdentifierChars: 128, maxDiagnostics: 20, maxDiagnosticChars: 4096 } };
const protocolDigest = createHash('sha256').update(JSON.stringify(contract), 'utf8').digest('hex');

export interface ModelPolicyCommandDependencies { approvePolicy?: (input: ApprovePolicyInput) => ReturnType<typeof approvePolicy>; readEffectivePolicy?: typeof readEffectivePolicy; approveCapabilities?: (input: ApproveCapabilitiesInput) => ReturnType<typeof approveCapabilities>; readCapabilities?: typeof readCapabilities; candidateDigest?: (input: CandidateDigestInput) => CandidateDigest; queryCodexModelCatalog?: typeof queryCodexModelCatalog; queryCodexChildThreadObservation?: typeof queryCodexChildThreadObservation; queryCodexMachineFacts?: typeof queryCodexMachineFacts; queryClaudeAuthStatus?: typeof queryClaudeAuthStatus; readClaudeModelConfigDigest?: typeof readClaudeModelConfigDigest; queryRuntimeExecutable?: typeof queryRuntimeExecutable; ensureMachineKey?: typeof ensureMachineKey; publishCodexObservation?: typeof publishCodexObservation; readStoredEventReceipt?: typeof readStoredEventReceipt; }
function text(value: unknown, label: string): asserts value is string { if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || value.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`${label} requires a non-empty value without control characters`); }
function output(value: unknown, json: boolean): void { process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`); }
function sameSelection(left: Selection, right: Selection): boolean {
    return left.selector.kind === right.selector.kind && left.selector.id === right.selector.id
        && left.effort.kind === right.effort.kind
        && (left.effort.kind !== 'explicit' || left.effort.value === (right.effort as { kind: 'explicit'; value: string }).value);
}
async function hookStdin(): Promise<unknown> {
    let content = '';
    for await (const chunk of process.stdin) {
        content += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (content.length > 64 * 1024) throw new Error('Claude hook event exceeds 64 KiB');
    }
    return parseJsonNoDuplicate(content);
}

export function registerModelPolicyCommand(program: Command, deps: ModelPolicyCommandDependencies = {}): void {
    if (!program || typeof program.command !== 'function') throw new Error('program must be a Commander command');
    const approve = deps.approvePolicy ?? approvePolicy; const read = deps.readEffectivePolicy ?? readEffectivePolicy; const approveReceipt = deps.approveCapabilities ?? approveCapabilities; const readReceipt = deps.readCapabilities ?? readCapabilities; const digest = deps.candidateDigest ?? candidateDigest;
    const command = program.command('model-policy').description('inspect and explicitly approve portable routing policy');
    command.command('contract').option('--cwd <path>').option('--json').action((options: { cwd?: string; json?: boolean }) => { if (options.cwd !== undefined) text(options.cwd, '--cwd'); output({ ...contract, protocolDigest }, options.json === true); });
    command.command('discover').description('compare approved selections with the native catalog; no inference or capability approval').requiredOption('--provider <target>').option('--cwd <path>').option('--json').action(async (options: { provider: string; cwd?: string; json?: boolean }) => {
        text(options.provider, '--provider');
        if (options.cwd !== undefined) text(options.cwd, '--cwd');
        if (!(AGENT_TARGETS as readonly string[]).includes(options.provider)) throw new Error('--provider is invalid');
        if (options.provider !== 'codex') {
            output({ state: 'unverified', provider: options.provider, reason: 'no native catalog adapter is installed for this provider', inferenceDispatched: false }, options.json === true);
            process.exitCode = 2;
            return;
        }
        const discovered = await (deps.queryCodexModelCatalog ?? queryCodexModelCatalog)({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000 });
        const effective = read(options.cwd ?? process.cwd());
        let policyCoverage: { state: 'not-configured' | 'policy-invalid' | 'complete' | 'missing'; missing: Selection[] };
        if (effective.state === 'absent') policyCoverage = { state: 'not-configured', missing: [] };
        else if (effective.state === 'invalid') policyCoverage = { state: 'policy-invalid', missing: [] };
        else {
            const requested = effective.policy.content.mappings.filter(mapping => mapping.target === 'codex')
                .flatMap(mapping => [...Object.values(mapping.profiles), mapping.fullCapability]);
            const missing = requested.filter((candidate, index) => !discovered.selections.some(available => sameSelection(candidate, available))
                && requested.findIndex(other => sameSelection(candidate, other)) === index);
            policyCoverage = { state: missing.length ? 'missing' : requested.length ? 'complete' : 'not-configured', missing };
        }
        output({ state: 'catalog-only', provider: 'codex', ...discovered, policyCoverage, inferenceDispatched: false }, options.json === true);
        if (policyCoverage.state !== 'complete') process.exitCode = 2;
    });
    command.command('setup').description('inspect one-time machine routing enrollment; never dispatch inference').requiredOption('--provider <target>').option('--cwd <path>').option('--json').action(async (options: { provider: string; cwd?: string; json?: boolean }) => {
        text(options.provider, '--provider');
        if (options.cwd !== undefined) text(options.cwd, '--cwd');
        if (!(AGENT_TARGETS as readonly string[]).includes(options.provider)) throw new Error('--provider is invalid');
        const effective = read(options.cwd ?? process.cwd());
        if (effective.state !== 'approved') {
            output({ state: effective.state === 'absent' ? 'policy-absent' : 'policy-invalid', provider: options.provider, inferenceDispatched: false, tokenUsage: 'unknown', remedy: effective.state === 'absent' ? 'Approve a model-policy/v1 candidate before machine enrollment.' : effective.reason }, options.json === true);
            process.exitCode = 2;
            return;
        }
        const mappings = effective.policy.content.mappings.filter(mapping => mapping.target === options.provider);
        if (mappings.length === 0) {
            output({ state: 'mapping-absent', provider: options.provider, inferenceDispatched: false, tokenUsage: 'unknown', remedy: 'Approve a mapping for this provider.' }, options.json === true);
            process.exitCode = 2;
            return;
        }
        const codex = options.provider === 'codex' ? await Promise.all([
            (deps.queryCodexModelCatalog ?? queryCodexModelCatalog)({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000 }),
            (deps.queryCodexMachineFacts ?? queryCodexMachineFacts)({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000,
                cwd: path.resolve(options.cwd ?? process.cwd()), key: (deps.ensureMachineKey ?? ensureMachineKey)(awmHome()) }),
            (deps.queryRuntimeExecutable ?? queryRuntimeExecutable)({ command: 'codex', args: ['--version'], timeoutMs: 10000 }),
        ]) : undefined;
        let claude: [Awaited<ReturnType<typeof queryRuntimeExecutable>>, Awaited<ReturnType<typeof queryClaudeAuthStatus>>, string] | undefined;
        if (options.provider === 'claude-code') {
            try {
                const key = (deps.ensureMachineKey ?? ensureMachineKey)(awmHome());
                claude = await Promise.all([
                    (deps.queryRuntimeExecutable ?? queryRuntimeExecutable)({ command: 'claude', args: ['--version'], timeoutMs: 10000 }),
                    (deps.queryClaudeAuthStatus ?? queryClaudeAuthStatus)({ command: 'claude', args: ['auth', 'status'], timeoutMs: 10000, key }),
                    Promise.resolve((deps.readClaudeModelConfigDigest ?? readClaudeModelConfigDigest)({ cwd: path.resolve(options.cwd ?? process.cwd()),
                        configDir: path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')), key, environment: process.env })),
                ]);
            } catch {
                output({ state: 'setup-pending', provider: 'claude-code', machine: { runtimeState: 'unavailable', accountState: 'unverified', configState: 'unverified' },
                    inferenceDispatched: false, tokenUsage: 'unknown', remedy: 'Install and authenticate Claude Code, then rerun awm model-policy setup --provider claude-code.' }, options.json === true);
                process.exitCode = 2;
                return;
            }
        }
        const catalog = codex?.[0];
        const codexMachine = codex ? { runtimeVersion: codex[2].version, binaryDigest: codex[2].binaryDigest, configDigest: codex[1].configDigest,
            accountState: codex[1].accountState, accountScopeDigest: codex[1].accountScopeDigest } : null;
        const machine = codexMachine ?? (claude ? { runtimeVersion: claude[0].version, binaryDigest: claude[0].binaryDigest, accountState: claude[1].accountState,
            accountScopeDigest: claude[1].accountScopeDigest, configState: 'local-fingerprint' as const, configDigest: claude[2] } : null);
        const scope = codexMachine?.accountState === 'identified' && codexMachine.accountScopeDigest ? { runtime: { target: 'codex' as const, kind: 'native', version: codexMachine.runtimeVersion, accountScopeDigest: codexMachine.accountScopeDigest },
            binaryDigest: codexMachine.binaryDigest, configDigest: codexMachine.configDigest } : claude?.[1].accountState === 'identified' && claude[1].accountScopeDigest ? {
            runtime: { target: 'claude-code' as const, kind: 'native', version: claude[0].version, accountScopeDigest: claude[1].accountScopeDigest },
            binaryDigest: claude[0].binaryDigest, configDigest: claude[2] } : null;
        const receipt = scope ? (deps.readStoredEventReceipt ?? readStoredEventReceipt)(scope.runtime) : { state: 'absent' as const };
        const readiness = (mapping: typeof mappings[number], requested: Selection): { selection: 'verified' | 'untested'; actualModel: 'observed' | 'untested' } => {
            if (!scope || mapping.runtimeKind !== scope.runtime.kind || receipt.state !== 'present') return { selection: 'untested', actualModel: 'untested' };
            if (evaluateEventReceipt(receipt.receipt, scope, requested, selectionPolicyDigest(mapping, requested), new Date()).state !== 'current') return { selection: 'untested', actualModel: 'untested' };
            const claim = receipt.receipt.claims.find(item => sameSelection(item.selection, requested));
            return { selection: 'verified', actualModel: requested.selector.kind === 'model' && claim?.actualModel !== 'unverified' && claim?.actualModel?.id === requested.selector.id ? 'observed' : 'untested' };
        };
        const selections = mappings.flatMap(mapping => [
            ...Object.entries(mapping.profiles).map(([role, requested]) => ({ runtimeKind: mapping.runtimeKind, role, requested, catalogAvailable: catalog ? catalog.selections.some(available => sameSelection(requested, available)) : null, dispatch: readiness(mapping, requested).selection, acceptedSelection: readiness(mapping, requested).selection, actualModel: readiness(mapping, requested).actualModel })),
            { runtimeKind: mapping.runtimeKind, role: 'fullCapability', requested: mapping.fullCapability, catalogAvailable: catalog ? catalog.selections.some(available => sameSelection(mapping.fullCapability, available)) : null, dispatch: readiness(mapping, mapping.fullCapability).selection, acceptedSelection: readiness(mapping, mapping.fullCapability).selection, actualModel: readiness(mapping, mapping.fullCapability).actualModel },
        ]);
        const hookStatus = options.provider === 'claude-code' ? computeClaudeHookStatus('claude-code').overall : null;
        const hookDiagnostic = options.provider === 'claude-code' ? readRoutingHookStatus() : null;
        const ready = selections.length > 0 && selections.every(item => item.dispatch === 'verified' && (item.catalogAvailable === true || (options.provider === 'claude-code' && item.catalogAvailable === null)))
            && mappings.every(mapping => mapping.degradation.allowMissingObservedIdentity || selections.filter(item => item.runtimeKind === mapping.runtimeKind).every(item => item.actualModel === 'observed'))
            && (hookStatus === null || hookStatus === 'HEALTHY') && (hookDiagnostic === null || hookDiagnostic.state !== 'failed' && hookDiagnostic.state !== 'invalid');
        const actualModelVerified = selections.length > 0 && selections.every(item => item.actualModel === 'observed');
        output({ state: ready ? 'ready-operational' : 'setup-pending', provider: options.provider, machine, selections, hookStatus, hookDiagnostic, nativeDispatchVerified: ready, actualModelVerified, inferenceDispatched: false, tokenUsage: 'unknown', policyAction: mappings.some(mapping => !mapping.degradation.allowMissingObservedIdentity && selections.some(item => item.runtimeKind === mapping.runtimeKind && item.actualModel !== 'observed')) ? 'Review and explicitly approve allowMissingObservedIdentity only if operational/degraded routing without backend identity is acceptable.' : null, remedy: ready ? null : options.provider === 'codex' ? 'Catalog coverage is not native dispatch proof. Capture each missing selection from a recent completed native child with awm model-policy capture.' : hookStatus !== 'HEALTHY' ? 'Run awm hooks install --agent claude-code. For each approved runtime-default model create one named awm-* custom agent with explicit full model ID in frontmatter, dispatch it once, then rerun setup.' : hookDiagnostic?.state === 'failed' || hookDiagnostic?.state === 'invalid' ? 'Claude hook capture failed; inspect hookDiagnostic and rerun one native awm-* subagent after fixing its named cause.' : 'Claude native selection is UNTESTED; create a named awm-* custom agent with an explicit full model ID for each approved runtime-default selection and dispatch it once.' }, options.json === true);
        if (!ready) process.exitCode = 2;
    });
    command.command('capture').description('enroll a completed native child turn for an approved Codex selection; no inference').requiredOption('--provider <target>').requiredOption('--runtime-kind <kind>').requiredOption('--parent-thread-id <id>').requiredOption('--child-thread-id <id>').option('--cwd <path>').option('--json').action(async (options: { provider: string; runtimeKind: string; parentThreadId: string; childThreadId: string; cwd?: string; json?: boolean }) => {
        text(options.provider, '--provider'); text(options.runtimeKind, '--runtime-kind'); text(options.parentThreadId, '--parent-thread-id'); text(options.childThreadId, '--child-thread-id');
        if (options.cwd !== undefined) text(options.cwd, '--cwd');
        if (options.provider !== 'codex' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(options.runtimeKind)) throw new Error('native capture supports only a valid Codex runtime kind');
        const cwd = path.resolve(options.cwd ?? process.cwd());
        const effective = read(cwd);
        if (effective.state !== 'approved') throw new Error('native capture requires an approved routing policy');
        const mapping = effective.policy.content.mappings.find(row => row.target === 'codex' && row.runtimeKind === options.runtimeKind);
        if (!mapping) throw new Error('approved Codex runtime mapping is absent');
        const key = (deps.ensureMachineKey ?? ensureMachineKey)(awmHome());
        const [machine, runtime, observation] = await Promise.all([
            (deps.queryCodexMachineFacts ?? queryCodexMachineFacts)({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000, cwd, key }),
            (deps.queryRuntimeExecutable ?? queryRuntimeExecutable)({ command: 'codex', args: ['--version'], timeoutMs: 10000 }),
            (deps.queryCodexChildThreadObservation ?? queryCodexChildThreadObservation)({ command: 'codex', args: ['app-server', '--stdio'], timeoutMs: 10000,
                parentThreadId: options.parentThreadId, childThreadId: options.childThreadId, codexHome: path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')) }),
        ]);
        if (machine.accountState !== 'identified' || !machine.accountScopeDigest) throw new Error('Codex account scope is unverified; native capture cannot certify this machine');
        const selections = [...Object.values(mapping.profiles), mapping.fullCapability];
        const expectedSelection = selections.find(candidate => sameSelection(candidate, observation.configuredSelection));
        if (!expectedSelection) throw new Error('Codex native child selection is not approved for this runtime');
        const mappingDigest = selectionPolicyDigest(mapping, expectedSelection);
        const receipt = (deps.publishCodexObservation ?? publishCodexObservation)({ scope: { runtime: { target: 'codex', kind: options.runtimeKind, version: runtime.version, accountScopeDigest: machine.accountScopeDigest },
            binaryDigest: runtime.binaryDigest, configDigest: machine.configDigest }, observation, expectedSelection, mappingDigest, now: new Date() });
        output({ state: 'captured', provider: 'codex', selection: expectedSelection, receipt, actualModelVerified: false, tokenUsage: 'unknown', inferenceDispatched: false }, options.json === true);
    });
    command.command('hook-event').description('collect Claude native subagent lifecycle metadata; no inference').requiredOption('--event <start-or-stop>').option('--cwd <path>').option('--json').action(async (options: { event: string; cwd?: string; json?: boolean }) => {
        if (options.event !== 'start' && options.event !== 'stop') throw new Error('--event must be start or stop');
        if (options.cwd !== undefined) text(options.cwd, '--cwd');
        const cwd = path.resolve(options.cwd ?? process.cwd());
        const effective = read(cwd);
        if (effective.state !== 'approved') { if (options.json) output({ state: 'ignored', reason: 'approved policy absent', inferenceDispatched: false }, true); return; }
        const mappings = effective.policy.content.mappings.filter(row => row.target === 'claude-code' && row.runtimeKind === 'native');
        if (mappings.length !== 1) { if (options.json) output({ state: 'ignored', reason: 'unique Claude native mapping absent', inferenceDispatched: false }, true); return; }
        let stage = 'HOOK_INPUT_INVALID';
        try {
            const value = await hookStdin();
            const agentType = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).agent_type : undefined;
            if (typeof agentType === 'string' && !agentType.startsWith('awm-')) {
                if (options.json) output({ state: 'ignored', reason: 'non-AWM agent type', inferenceDispatched: false }, true);
                return;
            }
            if (options.event === 'start') {
                stage = 'HOOK_START_UNVERIFIED';
                recordClaudeHookStart(value, new Date());
                recordRoutingHookStatus('start', 'success');
                if (options.json) output({ state: 'recorded', event: 'SubagentStart', inferenceDispatched: false }, true);
                return;
            }
            const now = new Date();
            stage = 'HOOK_PAIR_UNVERIFIED';
            const pair = readClaudeHookPair(value, now);
            const configDir = path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'));
            stage = 'HOOK_TRANSCRIPT_UNVERIFIED';
            const transcript = readClaudeSubagentTranscript({ configDir, file: pair.transcriptPath, agentId: pair.lifecycle.agentId });
            stage = 'HOOK_DECLARED_MODEL_UNVERIFIED';
            const declaredAgent = readClaudeAgentDeclaredModel({ cwd, configDir, agentType: pair.lifecycle.agentType });
            if (declaredAgent.modelId !== transcript.actualModel) throw new Error('Claude declared model differs from native child model');
            const mapping = mappings[0];
            const selections = [...Object.values(mapping.profiles), mapping.fullCapability];
            const expectedSelection = selections.find(candidate => candidate.selector.kind === 'model' && candidate.selector.id === transcript.actualModel && candidate.effort.kind === 'runtime-default');
            if (!expectedSelection) { if (options.json) output({ state: 'ignored', reason: 'Claude subagent selection does not match an approved runtime-default mapping', actualModel: transcript.actualModel, inferenceDispatched: false }, true); return; }
            stage = 'HOOK_SCOPE_UNVERIFIED';
            const local = await queryLocalClaudeScope(cwd, mapping.runtimeKind, { requireHookHealthy: false });
            if (local.state !== 'current') throw new Error('Claude native scope is unverified');
            stage = 'HOOK_RECEIPT_REJECTED';
            const receipt = publishClaudeObservation({ scope: local.scope, lifecycle: pair.lifecycle, transcript, declaredAgent, expectedSelection,
                mappingDigest: selectionPolicyDigest(mapping, expectedSelection), now });
            recordRoutingHookStatus('stop', 'success');
            if (options.json) output({ state: 'captured', provider: 'claude-code', selection: expectedSelection, receipt,
                actualModelVerified: true, tokenUsage: 'unknown', inferenceDispatched: false }, true);
        } catch {
            let alert = true;
            try { alert = recordRoutingHookStatus(options.event, stage); } catch { /* stderr still exposes failure */ }
            if (alert) process.stderr.write(`AWM Claude routing capture: ${stage}; inspect awm model-policy setup --provider claude-code --json\n`);
            if (options.json) output({ state: 'failed', reasonCode: stage, inferenceDispatched: false }, true);
            // A hook is observability, never a reason to block the native work.
        }
    });
    // Approval demands --expected-digest so that it stays an explicit operator
    // act. Without a way to observe the digest first, that safeguard blocked the
    // legitimate path instead of gating it, and the only way through was to
    // reimplement canonicalisation outside the CLI — the second parser the
    // admission contract forbids. This discloses the digest and approves nothing.
    command.command('digest').description('compute the canonical digest of a candidate policy or capability receipt without approving it').requiredOption('--file <path>').option('--cwd <path>').option('--json').action((options: { file: string; cwd?: string; json?: boolean }) => {
        text(options.file, '--file'); if (options.cwd !== undefined) text(options.cwd, '--cwd');
        output(digest({ file: options.file, cwd: options.cwd ?? process.cwd() }), options.json === true);
    });
    command.command('approve').requiredOption('--file <path>').requiredOption('--scope <scope>').requiredOption('--expected-digest <sha>').option('--replace-digest <sha>').option('--cwd <path>').option('--json').action((options: { file: string; scope: string; expectedDigest: string; replaceDigest?: string; cwd?: string; json?: boolean }) => {
        text(options.file, '--file'); text(options.scope, '--scope'); text(options.expectedDigest, '--expected-digest'); if (options.cwd !== undefined) text(options.cwd, '--cwd'); if (options.replaceDigest !== undefined) text(options.replaceDigest, '--replace-digest'); assertDigest(options.expectedDigest, 'expectedDigest'); if (options.replaceDigest !== undefined) assertDigest(options.replaceDigest, 'replaceDigest');
        const policy = approve({ file: options.file, scope: options.scope as 'user' | 'project', cwd: options.cwd ?? process.cwd(), expectedDigest: options.expectedDigest, replaceDigest: options.replaceDigest }); output({ state: 'approved', policy }, options.json === true);
    });
    // `command('capabilities approve')` registered ONE command named
    // `capabilities` with a required positional `<approve>`, so Commander called
    // the action as (positional, options, command) and the handler's first
    // parameter — read as `options` — was the string 'approve'. Every invocation
    // therefore died on `--file requires a non-empty value`, and the path could
    // never approve anything. A real subcommand group keeps the invocation
    // spelling identical and gives the action the options object it expects.
    const capabilities = command.command('capabilities').description('inspect and explicitly approve runtime capability attestations');
    capabilities.command('approve').requiredOption('--file <path>').requiredOption('--expected-digest <sha>').option('--replace-digest <sha>').option('--cwd <path>').option('--json').action((options: { file: string; expectedDigest: string; replaceDigest?: string; cwd?: string; json?: boolean }) => {
        text(options.file, '--file'); text(options.expectedDigest, '--expected-digest'); if (options.replaceDigest !== undefined) text(options.replaceDigest, '--replace-digest'); if (options.cwd !== undefined) text(options.cwd, '--cwd'); assertDigest(options.expectedDigest, 'expectedDigest'); if (options.replaceDigest) assertDigest(options.replaceDigest, 'replaceDigest');
        output({ state: 'approved', receipt: approveReceipt({ file: options.file, cwd: options.cwd ?? process.cwd(), expectedDigest: options.expectedDigest, replaceDigest: options.replaceDigest }) }, options.json === true);
    });
    command.command('status').requiredOption('--provider <target>').requiredOption('--runtime-kind <kind>').requiredOption('--runtime-version <version>').requiredOption('--account-scope-digest <sha>').option('--cwd <path>').option('--json').action((options: { provider: string; runtimeKind: string; runtimeVersion: string; accountScopeDigest: string; cwd?: string; json?: boolean }) => {
        text(options.provider, '--provider'); text(options.runtimeKind, '--runtime-kind'); text(options.runtimeVersion, '--runtime-version'); text(options.accountScopeDigest, '--account-scope-digest'); if (options.cwd !== undefined) text(options.cwd, '--cwd'); if (!(AGENT_TARGETS as readonly string[]).includes(options.provider)) throw new Error('--provider is invalid'); if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(options.runtimeKind)) throw new Error('--runtime-kind is invalid'); if (!/^\d+\.\d+\.\d+$/.test(options.runtimeVersion)) throw new Error('--runtime-version must be numeric semver'); assertDigest(options.accountScopeDigest, 'accountScopeDigest');
        const cwd = options.cwd ?? process.cwd(); const effective = read(cwd); const capability = readReceipt({ target: options.provider as any, kind: options.runtimeKind, version: options.runtimeVersion, accountScopeDigest: options.accountScopeDigest }, new Date()); output({ policy: effective, capability }, options.json === true); if (effective.state !== 'approved' || capability.state !== 'current') process.exitCode = 2;
    });
}
