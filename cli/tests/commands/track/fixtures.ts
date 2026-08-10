// Fixtures compartidas entre verbs.test.ts y status.test.ts — extraidas para
// que las dos copias no puedan divergir silenciosamente (code-quality review
// de Task 6).
import type { TrackRef } from '../../../src/core/journal/types';
import type { TrackDescriptor } from '../../../src/core/tracks/descriptor';

export function trackRefFixture(overrides: Partial<TrackRef>, worktreePath: string): TrackRef {
    return {
        trackId: 'cli', worktreePath, branch: 'track/cli', ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: 'f'.repeat(32), phase: 'ACTIVE', readinessNonce: 'n'.repeat(8), ...overrides,
    };
}

export function descriptorFixture(overrides: Partial<TrackDescriptor>, planRoot: string): TrackDescriptor {
    return { schema: 1, planRoot, planBranch: 'main', trackId: 'cli', planJournalId: 'j-1', fencingToken: 'f'.repeat(32), ...overrides };
}
