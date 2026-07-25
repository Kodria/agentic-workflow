import fs from 'fs';
import path from 'path';
import type { ProviderConfig } from '../../../providers';
import { homeDir } from '../../paths';
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
        this.assertGlobalInput(input);
        if (!fs.existsSync(input.ref.absPath)) {
            throw new Error(`materialized context not found at ${input.ref.absPath}`);
        }
        const markdown = fs.readFileSync(input.ref.absPath, 'utf8');
        return injectFile(this.globalPath(provider), markdown);
    }

    remove(input: InjectionInput, provider: ProviderConfig): void {
        this.assertGlobalInput(input);
        const file = this.globalPath(provider);
        if (!fs.existsSync(file)) return;
        const original = read(file);
        const removed = removeManagedBlock(original);
        if (removed !== original) writeFileAtomic(file, removed);
    }

    status(input: InjectionInput, provider: ProviderConfig): InjectionState {
        this.assertGlobalInput(input);
        const file = this.globalPath(provider);
        if (!fs.existsSync(file)) return 'absent';
        const body = managedBlockBody(read(file));
        if (body === null) return 'absent';
        if (!fs.existsSync(input.ref.absPath)) return 'stale';

        const expected = fs.readFileSync(input.ref.absPath, 'utf8');
        if (sha256(expected) !== input.ref.contentHash) return 'stale';
        return body === normalizeManagedBody(expected) ? 'injected' : 'stale';
    }

    injectGlobal(context: { markdown: string }): InjectResult {
        if (typeof context !== 'object' || context === null) {
            throw new Error('context must be an object');
        }
        if (typeof context.markdown !== 'string' || context.markdown.length === 0) {
            throw new Error('markdown must be a non-empty string');
        }
        return injectFile(path.join(homeDir(), '.codex', 'AGENTS.md'), context.markdown);
    }

    injectProject(projectRoot: string): InjectResult {
        if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
            throw new Error('projectRoot must be a non-empty string');
        }
        return injectFile(path.join(projectRoot, 'AGENTS.md'), PROJECT_GUIDANCE);
    }

    private assertGlobalInput(input: InjectionInput): void {
        if (typeof input !== 'object' || input === null) {
            throw new Error('input must be an object');
        }
        if (input.scope !== 'global' || input.ref?.scope !== 'global') {
            throw new Error('CodexAgentsStrategy supports only global injection');
        }
        if (typeof input.ref.absPath !== 'string' || input.ref.absPath.length === 0) {
            throw new Error('input.ref.absPath must be a non-empty string');
        }
    }
}
