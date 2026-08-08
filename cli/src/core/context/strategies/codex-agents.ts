import fs from 'fs';
import path from 'path';
import type { AgentTarget, ProviderConfig, Scope } from '../../../providers';
import { writeFileAtomic } from '../../atomic-file';
import {
    managedBlockBody,
    mergeManagedBlock,
    normalizeManagedBody,
    removeManagedBlock,
} from '../managed-block';
import { sha256 } from '../provider';
import type { InjectionInput, InjectionState } from '../types';
import type { InjectionStrategy } from './strategy';

type InjectResult = 'injected' | 'unchanged';

const PROJECT_GUIDANCE = [
    'Read and obey `CONSTITUTION.md` before work when that file exists.',
    'Use `.awm/profile.json` to declare project extensions, then run `awm sync`.',
    'Run the verification commands declared by the project before completion.',
].join('\n');

function read(file: string): string {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function injectFile(file: string, markdown: string): InjectResult {
    const original = read(file);
    const merged = mergeManagedBlock(original, markdown);
    if (merged === original) return 'unchanged';
    writeFileAtomic(file, merged);
    return 'injected';
}

/** For local-scope providers (Cursor/Copilot), context injection (`inject`) and project
 *  constitution injection (`injectProject`) target the SAME file — `targetFile`'s local
 *  branch resolves both to `<projectRoot>/<localFile>` (AGENTS.md). Global-scope providers
 *  (Codex) don't have this collision: context goes to a separate global file, constitution
 *  stays project-local. `mergeManagedBlock` supports only one managed slot per file, so for
 *  local scope the two payloads must be combined into a single write — `inject`/`status`
 *  append `PROJECT_GUIDANCE` here, and `injectProject` skips its own AGENTS.md write for
 *  these providers (see its `contextCoversThisFile` check) so there is exactly one writer. */
function withProjectGuidance(markdown: string, scope: Scope): string {
    return scope === 'local' ? `${markdown}\n\n${PROJECT_GUIDANCE}` : markdown;
}

export class CodexAgentsStrategy implements InjectionStrategy {
    private globalPath(provider: ProviderConfig): string {
        const injection = provider.injection;
        if (!injection || injection.type !== 'managed-agents-md') {
            throw new Error('CodexAgentsStrategy requires a managed-agents-md provider');
        }
        if (typeof injection.globalPath !== 'string' || injection.globalPath.length === 0) {
            throw new Error('managed-agents-md globalPath must be a non-empty string');
        }
        return injection.globalPath;
    }

    inject(input: InjectionInput, provider: ProviderConfig): InjectResult {
        const scope = this.assertSupportedScope(input, provider);
        if (!fs.existsSync(input.ref.absPath)) {
            throw new Error(`materialized context not found at ${input.ref.absPath}`);
        }
        const markdown = fs.readFileSync(input.ref.absPath, 'utf8');
        return injectFile(this.targetFile(provider, scope, input.projectRoot), withProjectGuidance(markdown, scope));
    }

    remove(input: InjectionInput, provider: ProviderConfig): void {
        const scope = this.assertSupportedScope(input, provider);
        const file = this.targetFile(provider, scope, input.projectRoot);
        if (!fs.existsSync(file)) return;
        const original = read(file);
        const removed = removeManagedBlock(original);
        if (removed !== original) writeFileAtomic(file, removed);
    }

    status(input: InjectionInput, provider: ProviderConfig): InjectionState {
        const scope = this.assertSupportedScope(input, provider);
        const file = this.targetFile(provider, scope, input.projectRoot);
        if (!fs.existsSync(file)) return 'absent';
        const body = managedBlockBody(read(file));
        if (body === null) return 'absent';
        if (!fs.existsSync(input.ref.absPath)) return 'stale';

        const expected = fs.readFileSync(input.ref.absPath, 'utf8');
        if (sha256(expected) !== input.ref.contentHash) return 'stale';
        return body === normalizeManagedBody(withProjectGuidance(expected, scope)) ? 'injected' : 'stale';
    }

    injectGlobal(context: { markdown: string }, provider: ProviderConfig): InjectResult {
        if (typeof context !== 'object' || context === null) {
            throw new Error('context must be an object');
        }
        if (typeof context.markdown !== 'string' || context.markdown.length === 0) {
            throw new Error('markdown must be a non-empty string');
        }
        return injectFile(this.globalPath(provider), context.markdown);
    }

    injectProject(projectRoot: string, provider: ProviderConfig, agent?: AgentTarget): InjectResult {
        if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
            throw new Error('projectRoot must be a non-empty string');
        }
        // A provider whose context injection is ITSELF local-scope (globalPath === null —
        // today: Cursor, Copilot) already owns this exact file's managed block via `inject()`
        // (see withProjectGuidance) — writing PROJECT_GUIDANCE here too would be a second
        // writer of the same single-slot block, silently overwriting whichever one runs last.
        // Global-scope providers (Codex) have no such collision: their context targets a
        // separate global file, so this is the only writer of the project AGENTS.md.
        const injection = provider.injection;
        const contextCoversThisFile = injection?.type === 'managed-agents-md' && injection.globalPath === null;
        const result = contextCoversThisFile
            ? 'unchanged'
            : injectFile(path.join(projectRoot, 'AGENTS.md'), PROJECT_GUIDANCE);
        let carrierResult: InjectResult = 'unchanged';
        if (agent === 'cursor') {
            // Cursor's Background/Cloud Agent does not reliably read AGENTS.md (open,
            // staff-acknowledged bug on Cursor's own community forum, unresolved as of
            // this research — see docs/plans/2026-08-07-team-rollout-hardening-design.md,
            // D4 correction note). Interactive Agent mode DOES read AGENTS.md, unaffected.
            // Write the same guidance as a redundant .mdc carrier with alwaysApply: true
            // so the managed context survives regardless of which Cursor mode is active.
            carrierResult = injectFile(
                path.join(projectRoot, '.cursor', 'rules', 'awm.mdc'),
                `---\ndescription: AWM project guidance (redundant carrier — see AGENTS.md)\nglobs:\nalwaysApply: true\n---\n\n${PROJECT_GUIDANCE}`,
            );
        }
        return result === 'injected' || carrierResult === 'injected' ? 'injected' : 'unchanged';
    }

    /** The scope this provider's managed-agents-md injection operates at: 'local'
     *  when it has no global AGENTS.md-equivalent (globalPath === null), else 'global'. */
    private requiredScope(provider: ProviderConfig): Scope {
        const injection = provider.injection;
        if (!injection || injection.type !== 'managed-agents-md') {
            throw new Error('CodexAgentsStrategy requires a managed-agents-md provider');
        }
        return injection.globalPath === null ? 'local' : 'global';
    }

    /** The actual file this strategy injects/removes/checks, given a scope. */
    private targetFile(provider: ProviderConfig, scope: Scope, projectRoot?: string): string {
        if (scope === 'global') return this.globalPath(provider);
        if (!projectRoot) throw new Error('projectRoot is required for local-scope injection');
        const injection = provider.injection;
        if (!injection || injection.type !== 'managed-agents-md') {
            throw new Error('CodexAgentsStrategy requires a managed-agents-md provider');
        }
        return path.join(projectRoot, injection.localFile);
    }

    private assertSupportedScope(input: InjectionInput, provider: ProviderConfig): Scope {
        if (typeof input !== 'object' || input === null) {
            throw new Error('input must be an object');
        }
        const required = this.requiredScope(provider);
        if (input.scope !== required || input.ref?.scope !== required) {
            throw new Error(`CodexAgentsStrategy for ${provider.label} supports only ${required} injection`);
        }
        if (typeof input.ref.absPath !== 'string' || input.ref.absPath.length === 0) {
            throw new Error('input.ref.absPath must be a non-empty string');
        }
        return required;
    }
}
