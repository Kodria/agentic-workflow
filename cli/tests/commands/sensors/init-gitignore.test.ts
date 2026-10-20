import fs from 'fs';
import os from 'os';
import path from 'path';
import { upsertAwmGitignore, AWM_GITIGNORE_BEGIN } from '../../../src/core/awm-gitignore';
import { ensureJournalGitignored } from '../../../src/commands/watch/init';

/**
 * Sensors init wiring is covered by asserting the shared ensure entry-point
 * used after bootstrap (and on noop repair) writes the managed block. Full
 * bootstrap fixtures are heavy; GI-1 is the upsert call site + this contract.
 */
describe('sensors/watch shared ensureJournalGitignored (GI-1/GI-2)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensors-gi-'));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('ensureJournalGitignored upserts the managed block (no bare .awm/ only)', () => {
        ensureJournalGitignored(tmp);
        const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
        expect(gi).toContain(AWM_GITIGNORE_BEGIN);
        expect(gi).toContain('!.awm/context-budget.json');
        expect(gi.split('\n').map((l) => l.trim()).filter((l) => l === '.awm' || l === '.awm/')).toEqual([]);
    });

    it('is safe to call when a managed block already exists (sensors noop repair)', () => {
        upsertAwmGitignore(tmp);
        const before = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
        ensureJournalGitignored(tmp);
        expect(fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8')).toBe(before);
    });
});
