import pc from 'picocolors';
import {
    ArtifactTargetPair,
    preflightLinkArtifactPairs,
} from '../core/provider-artifacts';

export type ProviderPreflightIO = {
    error(message: string): void;
    exit(code: number): void;
};

function defaultIO(): ProviderPreflightIO {
    return {
        error: (message) => { console.error(message); },
        exit: (code) => { process.exit(code); },
    };
}

export function preflightLinkArtifactsForCli(
    pairs: readonly ArtifactTargetPair[],
    io: ProviderPreflightIO = defaultIO(),
): boolean {
    try {
        preflightLinkArtifactPairs(pairs);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.error(pc.red(message));
        io.exit(1);
        return false;
    }
}
