import fs from 'fs';
import os from 'os';
import path from 'path';

import { checkBudget, readConfig, CONFIG_FILE } from '../../../src/commands/context-budget/budget';
import { exitCodeFor, formatReport } from '../../../src/commands/context-budget';
import { mkCanonicalTmpDir } from '../../support/tmp';

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

// Fijar sobre cero archivos garantiza una falsa alarma en la corrida siguiente.
//
// `context-budget` mide AGENTS.md / CONSTITUTION.md / CLAUDE.md. En un proyecto recien
// inicializado NINGUNO existe: los escribe una sesion de agente, y `awm init` los reporta
// como pasos `pending`. El 0KB no es un error de medicion — no hay nada que medir. El
// problema es FIJAR sobre eso: apenas el agente escribe AGENTS.md, que es el flujo
// documentado, el comando reporta "excedido". Una alarma que siempre suena se aprende a
// ignorar. Ver issue #56.
describe('pinning refuses to happen when there is nothing to measure', () => {
    let cwd: string;

    beforeEach(() => { cwd = mkCanonicalTmpDir('awm-budget-zero-'); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    it('does not pin a budget on a project whose context files do not exist yet', () => {
        const report = checkBudget(cwd);
        expect(report.status).toBe('unmeasurable');
        expect(report.totalBytes).toBe(0);
        // Lo que importa: NO deja config. Un `maxBytes: 0` en disco es la trampa.
        expect(fs.existsSync(path.join(cwd, CONFIG_FILE))).toBe(false);
    });

    it('the very next run, after the agent writes AGENTS.md, is not "over budget"', () => {
        checkBudget(cwd);                                    // primer intento: nada que medir
        fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'x'.repeat(3000));

        const report = checkBudget(cwd);
        // Este es el bug entero: antes daba 'over' — 3KB contra un maximo de 0.
        expect(report.status).toBe('pinned');
        expect(report.maxBytes).toBe(3000);
    });

    it('still pins normally when at least one context file exists', () => {
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'y'.repeat(500));
        const report = checkBudget(cwd);
        expect(report.status).toBe('pinned');
        expect(report.maxBytes).toBe(500);
        expect(fs.existsSync(path.join(cwd, CONFIG_FILE))).toBe(true);
    });
});
