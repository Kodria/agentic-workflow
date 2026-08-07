import fs from 'fs';
import os from 'os';
import path from 'path';

import { checkBudget, readConfig, CONFIG_FILE } from '../../../src/commands/context-budget/budget';
import { exitCodeFor, formatReport } from '../../../src/commands/context-budget';

function project(files: Record<string, number>): string {
    // CLAUDE.md: no test may reach the real ~/.awm. Everything here is a tmpdir.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-budget-'));
    for (const [name, bytes] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), 'a'.repeat(bytes));
    }
    return dir;
}

describe('checkBudget', () => {
    const dirs: string[] = [];
    const make = (f: Record<string, number>) => { const d = project(f); dirs.push(d); return d; };
    afterAll(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

    it('pins the current total on the first check instead of failing', () => {
        // Adopting this must never block a repo that is already large — it only stops
        // it getting larger. A first-run failure would make it unadoptable exactly
        // where it is most needed.
        const dir = make({ 'AGENTS.md': 5000, 'CONSTITUTION.md': 3000 });

        const report = checkBudget(dir);

        expect(report.status).toBe('pinned');
        expect(report.totalBytes).toBe(8000);
        expect(readConfig(dir)!.maxBytes).toBe(8000);
    });

    it('reports over once the files grow past the pin', () => {
        const dir = make({ 'AGENTS.md': 5000 });
        checkBudget(dir);                                        // pin at 5000
        fs.appendFileSync(path.join(dir, 'AGENTS.md'), 'b'.repeat(2000));

        const report = checkBudget(dir);

        expect(report.status).toBe('over');
        expect(report.totalBytes).toBe(7000);
        expect(report.maxBytes).toBe(5000);
    });

    it('goes quiet again once pruned back under budget', () => {
        const dir = make({ 'AGENTS.md': 5000 });
        checkBudget(dir);
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'a'.repeat(4000));

        expect(checkBudget(dir).status).toBe('within');
    });

    it('does not re-pin on later checks, so the budget is a real ratchet', () => {
        // If a later check re-pinned, growth would always look like the new normal and
        // the budget would never mean anything.
        const dir = make({ 'AGENTS.md': 5000 });
        checkBudget(dir);
        fs.appendFileSync(path.join(dir, 'AGENTS.md'), 'b'.repeat(9000));
        checkBudget(dir);

        expect(readConfig(dir)!.maxBytes).toBe(5000);
    });

    it('counts only the files that exist', () => {
        const dir = make({ 'AGENTS.md': 1000 });   // no CONSTITUTION.md, no CLAUDE.md

        const report = checkBudget(dir);

        expect(report.totalBytes).toBe(1000);
        expect(report.breakdown.map(b => b.file)).toEqual(['AGENTS.md']);
    });

    it('re-pins when the config is unreadable rather than treating it as no limit', () => {
        // An unparseable budget must not silently disable the check — that is the quiet
        // direction of wrong, where it stops checking and still reports success.
        const dir = make({ 'AGENTS.md': 2000 });
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, CONFIG_FILE), '{ not json');

        const report = checkBudget(dir);

        expect(report.status).toBe('pinned');
        expect(readConfig(dir)!.maxBytes).toBe(2000);
    });

    it('honours a custom file list from the config', () => {
        const dir = make({ 'AGENTS.md': 1000, 'OTHER.md': 500 });
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify({ files: ['OTHER.md'], maxBytes: 100 }));

        const report = checkBudget(dir);

        expect(report.totalBytes).toBe(500);
        expect(report.status).toBe('over');
    });
});

describe('reporting', () => {
    it('exits non-zero only when over budget', () => {
        expect(exitCodeFor({ status: 'over', totalBytes: 2, maxBytes: 1, breakdown: [] })).toBe(1);
        expect(exitCodeFor({ status: 'within', totalBytes: 1, maxBytes: 2, breakdown: [] })).toBe(0);
        expect(exitCodeFor({ status: 'pinned', totalBytes: 1, maxBytes: 1, breakdown: [] })).toBe(0);
    });

    it('offers the three choices when over, since this runs while a human is present', () => {
        const out = formatReport({
            status: 'over',
            totalBytes: 227_000,
            maxBytes: 224_000,
            breakdown: [{ file: 'AGENTS.md', bytes: 145_000 }],
        });

        expect(out).toContain('Prune');
        expect(out).toContain('Raise');
        expect(out).toContain('Accept');
        expect(out).toMatch(/~5[0-9]k tokens/);
    });
});
