import { makeRepo, spyOnGit, type TestRepo } from './helpers';
import { SINCE_48H, record, recordPath } from './list-fixtures';
import { listChanges, type ListOutcome } from '../../../src/core/changes/list';

// One 201-commit repository, built once and only ever read: no test writes into it and no test needs a repository of its own.
let big: TestRepo;
beforeAll(() => {
    big = makeRepo();
    big.commit({ [recordPath('2026-10-10-adopt')]: record('2026-10-10-adopt') }, 'feat: adopt', '2026-10-10T00:00:00Z');
    for (let i = 1; i <= 201; i++) big.gitAt('2026-10-16T10:00:00Z', 'commit', '--allow-empty', '-q', '-m', `fix: n${i}`);
}, 180_000);
afterAll(() => big.cleanup());
afterEach(() => jest.restoreAllMocks());

const listBig = (opts: Record<string, unknown> = {}): ListOutcome => listChanges(big.root, { since: SINCE_48H, ...opts } as never);
const result = (outcome: ListOutcome) => {
    if (!outcome.ok) throw new Error(outcome.failure.message);
    return outcome.result;
};
/** How many git children a run spawns. */
const spawns = (opts: Record<string, unknown>): number => {
    const spy = spyOnGit();
    result(listBig(opts));
    spy.restore();
    return spy.calls.length;
};

describe('listChanges: a long history (R5.7)', () => {
    test('beyond 200 entries only the newest 200 are listed and the rest is counted', () => {
        const r = result(listBig());
        expect(r.changes).toHaveLength(200);
        expect(r.changes[0].subject).toBe('fix: n201');
        expect(r.changes[199].subject).toBe('fix: n2');
        expect(r).toMatchObject({ truncated: true, omitted: 1 });
    }, 180_000);
    test('the entries beyond a small limit are only counted', () => {
        expect(result(listBig({ limit: 3 }))).toMatchObject({ truncated: true, omitted: 198 });
    });
    test('the whole history fits one page, so the scan is one git call', () => {
        const spy = spyOnGit();
        result(listBig({ limit: 3 }));
        spy.restore();
        expect(spy.calls.filter((a) => a.includes('--format=%H%x1f%ct%x1f%P'))).toHaveLength(1);
    });
    test('git calls per entry are constant: an entry costs the same however many there are', () => {
        expect((spawns({ limit: 25 }) - spawns({ limit: 5 })) / 20).toBeLessThanOrEqual(4);
    });
    test('entries beyond the limit cost no per-entry call', () => {
        expect(spawns({ limit: 5 })).toBeLessThan(spawns({ limit: 25 }) / 2);
    });
});
