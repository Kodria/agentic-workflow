import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeGate, computeTrackGate } from '../../../src/commands/job/gate';
import { queryList, queryPs, queryShow } from '../../../src/commands/job/query';
import { ABSENT_JOURNAL_DETAIL, journalPresence, readJournal, writeJournal } from '../../../src/core/journal/store';
import { journalDir, statePath } from '../../../src/core/journal/paths';
import { emptyState } from '../../../src/core/journal/types';

// #173. A journal that was never created is a different FACT from a damaged
// one, and needs a different response: absence is resolved by
// `awm watch --init --plan`, corruption by inspecting the file. `readJournal`
// collapsed both into `corrupt: true`, so a healthy repository with no journal
// told the operator its state file was unreadable.
//
// These are two separate cases with two separate assertions on purpose: a single
// test on "not pass" would not distinguish them, which is how this survived.
const BRANCH = 'main';

describe('an absent journal is not a corrupt one', () => {
    let repo: string;
    let previous: { home?: string; awmHome?: string };

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-173-'));
        previous = { home: process.env.HOME, awmHome: process.env.AWM_HOME };
        process.env.HOME = path.join(repo, 'operator-home');
        process.env.AWM_HOME = path.join(repo, 'awm-home');
    });

    afterEach(() => {
        for (const [key, value] of [['HOME', previous.home], ['AWM_HOME', previous.awmHome]] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(repo, { recursive: true, force: true });
    });

    function writeState(body: string) {
        fs.mkdirSync(journalDir(repo, BRANCH), { recursive: true });
        fs.writeFileSync(statePath(repo, BRANCH), body);
    }

    it('reports a repository that never had a journal as absent, never corrupt', () => {
        const read = readJournal(repo, BRANCH);
        expect(read).toEqual({ state: null, corrupt: false, absent: true });
        expect(journalPresence(read)).toBe('absent');
    });

    it.each([
        ['truncated JSON', '{"schema":2,"branch":"'],
        ['well-formed JSON of the wrong shape', '{"nope":1}'],
        ['an empty file', ''],
    ])('still reports %s as corrupt, not absent', (_case, body) => {
        writeState(body);
        const read = readJournal(repo, BRANCH);
        expect(read.corrupt).toBe(true);
        expect(read.absent).toBe(false);
        expect(journalPresence(read)).toBe('corrupt');
    });

    // The adversarial case this change had to survive: `readFileSync` on a
    // dangling symlink raises ENOENT, so a naive ENOENT check would report an
    // attacker-placed link as an innocent absence. The symlink assertion runs
    // first and throws without an errno, which is what keeps that impossible.
    it('never reports a symlinked state file as absence, even a dangling one', () => {
        fs.mkdirSync(journalDir(repo, BRANCH), { recursive: true });
        fs.symlinkSync(path.join(repo, 'no-such-target'), statePath(repo, BRANCH));
        const read = readJournal(repo, BRANCH);
        expect(read.corrupt).toBe(true);
        expect(read.absent).toBe(false);
    });

    it('never reports a symlinked journal directory as absence', () => {
        fs.mkdirSync(path.join(repo, 'elsewhere'), { recursive: true });
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.symlinkSync(path.join(repo, 'elsewhere'), path.join(repo, '.awm', 'journal'));
        const read = readJournal(repo, BRANCH);
        expect(read.corrupt).toBe(true);
        expect(read.absent).toBe(false);
    });

    // Absence used to arrive at writeJournal as `corrupt`, and that is what kept
    // journal creation exclusive to initJournal/initBoundJournal. Naming it must
    // not have loosened that.
    it('still refuses to create a journal through the write path', () => {
        expect(() => writeJournal(repo, BRANCH, emptyState(BRANCH)))
            .toThrow(/journal inexistente: la creacion es de initJournal/);
        expect(fs.existsSync(statePath(repo, BRANCH))).toBe(false);
    });

    it('reports absence through the job queries without dereferencing a null state', () => {
        expect(queryPs(repo, BRANCH)).toEqual({ corruptState: false, journal: 'absent', jobs: [] });
        expect(queryList(repo, BRANCH)).toEqual({ corruptState: false, journal: 'absent', cycleStatus: null, jobs: [] });
        expect(queryShow(repo, BRANCH, 'j1')).toEqual({ corruptState: false, journal: 'absent', job: null });
    });

    it('reports corruption through the job queries with corruptState still true', () => {
        writeState('{"schema":2,"branch":"');
        expect(queryPs(repo, BRANCH)).toEqual({ corruptState: true, journal: 'corrupt', jobs: [] });
        expect(queryList(repo, BRANCH)).toEqual({ corruptState: true, journal: 'corrupt', cycleStatus: null, jobs: [] });
        expect(queryShow(repo, BRANCH, 'j1')).toEqual({ corruptState: true, journal: 'corrupt', job: null });
    });
});

describe('the gates name absence and still fail closed', () => {
    const fingerprint = () => 'fp';

    it('reports an absent journal as absent, and names the command that creates one', () => {
        const gate = computeGate(null, false, fingerprint, true);
        expect(gate.pass).toBe(false);
        expect(gate.reasons).toEqual([{ category: 'absent', detail: ABSENT_JOURNAL_DETAIL }]);
        expect(gate.reasons[0].detail).toContain('awm watch --init --plan');
        // The interlock has no plan binding to read an execution mode from when
        // the journal is missing, so it does not certify on absence either.
        expect(gate.reasons[0].detail).toContain('interactivo');
    });

    it('reports a corrupt journal as corrupt even when absence is also claimed', () => {
        expect(computeGate(null, true, fingerprint, true).reasons)
            .toEqual([expect.objectContaining({ category: 'corrupt' })]);
    });

    // Proves the 60 existing call sites are unchanged: without the new argument a
    // null state still fails closed exactly as before.
    it('keeps every caller that omits the new argument failing closed as corrupt', () => {
        expect(computeGate(null, false, fingerprint).pass).toBe(false);
        expect(computeGate(null, false, fingerprint).reasons)
            .toEqual([expect.objectContaining({ category: 'corrupt' })]);
    });

    it('distinguishes the same two facts for a track gate', () => {
        expect(computeTrackGate(null, false, fingerprint, true).reasons)
            .toEqual([{ category: 'absent-state', detail: ABSENT_JOURNAL_DETAIL }]);
        expect(computeTrackGate(null, true, fingerprint, true).reasons)
            .toEqual([expect.objectContaining({ category: 'corrupt-state' })]);
        expect(computeTrackGate(null, false, fingerprint).reasons)
            .toEqual([expect.objectContaining({ category: 'corrupt-state' })]);
    });

    it('does not report absence for a journal that is present', () => {
        const gate = computeGate(emptyState('main'), false, fingerprint, false);
        expect(gate.reasons).not.toContainEqual(expect.objectContaining({ category: 'absent' }));
    });
});
