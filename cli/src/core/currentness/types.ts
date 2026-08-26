import type { AwmPreferences } from '../../utils/config';
import type { RegistrySource } from '../registries';

export type CurrentnessStatus = 'current' | 'stale' | 'pinned-behind' | 'unverifiable';

export interface CurrentnessComponent {
    component: string;
    installed: string | null;
    latest: string | null;
    channel: 'stable';
    source: string;
    pin?: string;
    checkedAt: string;
    status: CurrentnessStatus;
    detail: string;
    remedy: string;
}

export interface CurrentnessReport {
    checkedAt: string;
    components: CurrentnessComponent[];
    /** Deliberately distinct from remote-currentness; S4 supplies compatibility verdicts. */
    compatibility: { status: 'not-checked' };
}

export interface GitOptions { timeoutMs: number; maxOutputBytes: number; }
export type GitTransport = (cwd: string, args: string[], options: GitOptions) => Promise<string>;

export interface CurrentnessDeps {
    fetch?: typeof fetch;
    git?: GitTransport;
    now?: () => number;
    cliVersion?: () => string;
    readPreferences?: () => AwmPreferences;
    listRegistries?: () => RegistrySource[];
    env?: NodeJS.ProcessEnv;
}
