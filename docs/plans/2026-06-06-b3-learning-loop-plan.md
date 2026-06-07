# Body B-3 — El loop de aprendizaje (el trinquete) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, project-local findings ledger and rewire `harness-retro` to be ledger-driven and interactive, so the harness learns from each development session (wins and errors) and cures that learning into existing delivered docs without saturating context.

**Architecture:** A new `awm ledger` CLI subcommand owns a per-branch jsonl working-memory store under `.awm/ledger/` (gitignored, never injected into context). The phases that already produce findings (SDD reviewers, post-qa, sensor recurrence, systematic-debugging) append entries — errors **and** wins. `harness-retro` becomes a terminal phase of `development-process`: it reads the ledger, presents everything interactively, and cures decisions into the remediation tree / `CONSTITUTION.md` / `AGENTS.md`, then archives the ledger.

**Tech Stack:** TypeScript (`cli/`, commander + jest, `--runInBand`), jsonl, registry skill markdown.

**Design doc:** `docs/plans/2026-06-06-b3-learning-loop-design.md`

**Test runner:** `cd cli && npx jest --runInBand`

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `cli/src/core/ledger/types.ts` | Ledger entry types (pure types) | T1 |
| `cli/src/core/ledger/store.ts` | Pure store: branch detection, paths, add/list/recurring/archive | T1, T2 |
| `cli/src/commands/ledger/index.ts` | `registerLedgerCommand` — CLI wrapper over the store | T3 |
| `cli/src/index.ts` | Wire `registerLedgerCommand(program)` | T3 |
| `cli/tests/core/ledger/store.test.ts` | Unit tests for the store | T1, T2 |
| `cli/tests/commands/ledger/index.test.ts` | CLI command wiring tests | T3 |
| `cli/tests/registry/b3-ledger-wiring.test.ts` | Prose regression: skills emit `awm ledger add`, harness-retro is ledger-driven, dev-process routes the phase | T5, T6, T7 |
| `cli/tests/core/ledger/gitignore.test.ts` | Assert `.awm/` (hence `.awm/ledger/`) is gitignored | T4 |
| `registry/skills/harness-retro/SKILL.md` | Rewritten ledger-driven + interactive + two-tier curation | T5 |
| `registry/skills/subagent-driven-development/spec-reviewer-prompt.md` | Emit findings + wins to ledger | T6 |
| `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md` | Emit findings + wins to ledger | T6 |
| `registry/skills/post-implementation-qa/deep-review-prompt.md` | Emit findings + wins to ledger | T6 |
| `registry/skills/post-implementation-qa/SKILL.md` | Reference ledger add step | T6 |
| `registry/skills/verification-before-completion/SKILL.md` | Recurring sensor failure → ledger add | T6 |
| `registry/skills/systematic-debugging/SKILL.md` | Root-cause confirmed → ledger add | T6 |
| `registry/skills/development-process/SKILL.md` | harness-retro as terminal phase + routing + marker | T7 |

---

## Task 1: Ledger types + store core (branch, paths, add, list)

**Files:**
- Create: `cli/src/core/ledger/types.ts`
- Create: `cli/src/core/ledger/store.ts`
- Test: `cli/tests/core/ledger/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/core/ledger/store.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { addEntry, listEntries, ledgerPath, detectBranch } from '../../../src/core/ledger/store';
import type { LedgerEntry } from '../../../src/core/ledger/types';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ledger-'));
}

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        ts: '2026-06-06T00:00:00.000Z',
        branch: 'feat-x',
        phase: 'post-qa',
        source_skill: 'post-implementation-qa',
        polarity: 'finding',
        class: 'logica',
        signature: 'public-fn-returns-infinity',
        severity: 'blocker',
        desc: 'splitBill(100,0) returns Infinity',
        ref: 'src/split.ts:12',
        ...over,
    };
}

describe('ledger store — add/list', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('ledgerPath sanitizes branch slashes into the filename', () => {
        expect(ledgerPath(cwd, 'feature/foo')).toBe(path.join(cwd, '.awm', 'ledger', 'feature__foo.jsonl'));
    });

    test('addEntry creates .awm/ledger/ and appends one jsonl line', () => {
        addEntry(cwd, entry());
        const raw = fs.readFileSync(ledgerPath(cwd, 'feat-x'), 'utf-8');
        expect(raw.trim().split('\n')).toHaveLength(1);
        expect(JSON.parse(raw.trim())).toMatchObject({ signature: 'public-fn-returns-infinity', polarity: 'finding' });
    });

    test('addEntry appends without clobbering prior entries', () => {
        addEntry(cwd, entry());
        addEntry(cwd, entry({ signature: 'second', desc: 'another' }));
        expect(listEntries(cwd, 'feat-x')).toHaveLength(2);
    });

    test('listEntries on a branch with no ledger returns []', () => {
        expect(listEntries(cwd, 'never-touched')).toEqual([]);
    });

    test('listEntries skips a malformed line without throwing', () => {
        const p = ledgerPath(cwd, 'feat-x');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(entry()) + '\n' + 'NOT JSON\n' + JSON.stringify(entry({ signature: 's2' })) + '\n');
        const got = listEntries(cwd, 'feat-x');
        expect(got).toHaveLength(2);
        expect(got.map(e => e.signature)).toEqual(['public-fn-returns-infinity', 's2']);
    });
});

describe('ledger store — detectBranch', () => {
    test('falls back to _no-branch outside a git repo', () => {
        const tmp = mkTmp();
        try {
            expect(detectBranch(tmp)).toBe('_no-branch');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest --runInBand tests/core/ledger/store.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/ledger/store'`.

- [ ] **Step 3: Write the types**

Create `cli/src/core/ledger/types.ts`:

```ts
export type Polarity = 'win' | 'finding';
export type LedgerClass = 'structural' | 'logica' | 'proceso' | 'seguridad';
export type Severity = 'blocker' | 'important' | 'minor' | 'info';

export interface LedgerEntry {
    ts: string;            // ISO-8601, set by the CLI layer
    branch: string;        // git branch, or '_no-branch'
    phase: string;         // e.g. 'post-qa', 'spec-review', 'code-quality-review', 'sensors', 'debugging'
    source_skill: string;  // skill that emitted the entry
    polarity: Polarity;
    class: LedgerClass;
    signature: string;     // dedup key — exact-match grouping
    severity: Severity;
    desc: string;
    ref?: string;          // file:line or PR/commit ref
}
```

- [ ] **Step 4: Write the store (add/list/branch/paths)**

Create `cli/src/core/ledger/store.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { LedgerEntry } from './types';

const LEDGER_DIR = path.join('.awm', 'ledger');

/** git branch name for cwd, or '_no-branch' when there's no resolvable branch. */
export function detectBranch(cwd: string): string {
    try {
        const b = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
        }).trim();
        return b && b !== 'HEAD' ? b : '_no-branch';
    } catch {
        return '_no-branch';
    }
}

/** Absolute path to a branch's ledger file. Branch slashes are sanitized to '__'. */
export function ledgerPath(cwd: string, branch: string): string {
    const safe = branch.replace(/\//g, '__');
    return path.join(cwd, LEDGER_DIR, `${safe}.jsonl`);
}

/** Append one entry as a jsonl line, creating .awm/ledger/ if needed. */
export function addEntry(cwd: string, entry: LedgerEntry): void {
    const p = ledgerPath(cwd, entry.branch);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read all entries for a branch. Malformed lines are skipped, not fatal. */
export function listEntries(cwd: string, branch: string): LedgerEntry[] {
    const p = ledgerPath(cwd, branch);
    if (!fs.existsSync(p)) return [];
    const out: LedgerEntry[] = [];
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { out.push(JSON.parse(trimmed) as LedgerEntry); }
        catch { /* skip malformed line */ }
    }
    return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd cli && npx jest --runInBand tests/core/ledger/store.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/ledger/types.ts cli/src/core/ledger/store.ts cli/tests/core/ledger/store.test.ts
git commit -m "feat(ledger): store core — add/list + branch detection (B-3 #1)"
```

---

## Task 2: Ledger store — recurring + archive

**Files:**
- Modify: `cli/src/core/ledger/store.ts`
- Test: `cli/tests/core/ledger/store.test.ts:append`

- [ ] **Step 1: Write the failing test**

Append to `cli/tests/core/ledger/store.test.ts`:

```ts
import { recurring, archiveLedger } from '../../../src/core/ledger/store';

describe('ledger store — recurring', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('groups by signature and reports clusters with count >= min', () => {
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'solo' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ signature: 'dup', count: 2 });
        expect(clusters[0].entries).toHaveLength(2);
    });

    test('respects --min: count 2 is excluded when min is 3', () => {
        addEntry(cwd, entry({ signature: 'dup' }));
        addEntry(cwd, entry({ signature: 'dup' }));
        expect(recurring(cwd, 'feat-x', 3)).toEqual([]);
    });

    test('sorts clusters by count descending', () => {
        addEntry(cwd, entry({ signature: 'a' }));
        addEntry(cwd, entry({ signature: 'a' }));
        addEntry(cwd, entry({ signature: 'b' }));
        addEntry(cwd, entry({ signature: 'b' }));
        addEntry(cwd, entry({ signature: 'b' }));
        const clusters = recurring(cwd, 'feat-x', 2);
        expect(clusters.map(c => c.signature)).toEqual(['b', 'a']);
    });
});

describe('ledger store — archive', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('moves the branch ledger into archive/ and leaves no active ledger', () => {
        addEntry(cwd, entry());
        const moved = archiveLedger(cwd, 'feat-x', '20260606T000000');
        expect(moved).toBe(true);
        expect(fs.existsSync(ledgerPath(cwd, 'feat-x'))).toBe(false);
        expect(fs.existsSync(path.join(cwd, '.awm', 'ledger', 'archive', 'feat-x-20260606T000000.jsonl'))).toBe(true);
    });

    test('archiving a non-existent ledger is a no-op returning false', () => {
        expect(archiveLedger(cwd, 'feat-x', '20260606T000000')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest --runInBand tests/core/ledger/store.test.ts`
Expected: FAIL — `recurring`/`archiveLedger` not exported.

- [ ] **Step 3: Add recurring + archive to the store**

Append to `cli/src/core/ledger/store.ts`:

```ts
export interface RecurringCluster {
    signature: string;
    count: number;
    entries: LedgerEntry[];
}

/** Group a branch's entries by exact signature; return clusters with count >= min, count-descending. */
export function recurring(cwd: string, branch: string, min: number): RecurringCluster[] {
    const bySig = new Map<string, LedgerEntry[]>();
    for (const e of listEntries(cwd, branch)) {
        const arr = bySig.get(e.signature) ?? [];
        arr.push(e);
        bySig.set(e.signature, arr);
    }
    return [...bySig.entries()]
        .map(([signature, entries]) => ({ signature, count: entries.length, entries }))
        .filter(c => c.count >= min)
        .sort((a, b) => b.count - a.count);
}

/** Move a branch's ledger to archive/<branch>-<label>.jsonl. No-op (false) when absent. */
export function archiveLedger(cwd: string, branch: string, label: string): boolean {
    const src = ledgerPath(cwd, branch);
    if (!fs.existsSync(src)) return false;
    const safe = branch.replace(/\//g, '__');
    const dst = path.join(cwd, LEDGER_DIR, 'archive', `${safe}-${label}.jsonl`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest --runInBand tests/core/ledger/store.test.ts`
Expected: PASS (all tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/ledger/store.ts cli/tests/core/ledger/store.test.ts
git commit -m "feat(ledger): recurring clustering + archive (B-3 #1)"
```

---

## Task 3: `awm ledger` CLI command + index wiring

**Files:**
- Create: `cli/src/commands/ledger/index.ts`
- Modify: `cli/src/index.ts` (add import + `registerLedgerCommand(program)`)
- Test: `cli/tests/commands/ledger/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/commands/ledger/index.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { registerLedgerCommand } from '../../../src/commands/ledger';
import { listEntries } from '../../../src/core/ledger/store';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ledger-cli-'));
}

function run(argv: string[], cwd: string): string {
    const prog = new Command();
    prog.exitOverride();
    registerLedgerCommand(prog);
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    try {
        prog.parse(['node', 'awm', 'ledger', ...argv]);
    } finally {
        cwdSpy.mockRestore();
    }
    const out = spy.mock.calls.map(c => String(c[0])).join('');
    spy.mockRestore();
    return out;
}

describe('awm ledger CLI', () => {
    let cwd: string;
    beforeEach(() => { cwd = mkTmp(); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    test('add writes an entry to the current branch ledger', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
             '--signature', 'sig-1', '--severity', 'blocker', '--desc', 'boom', '--ref', 'a.ts:1'], cwd);
        const entries = listEntries(cwd, 'feat-x');
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ signature: 'sig-1', polarity: 'finding', class: 'logica' });
        expect(entries[0].ts).toMatch(/\d{4}-\d{2}-\d{2}T/); // CLI stamped an ISO ts
    });

    test('list emits the branch entries as JSON', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'win', '--class', 'proceso',
             '--signature', 'good', '--severity', 'info', '--desc', 'nice'], cwd);
        const out = run(['list', '--branch', 'feat-x'], cwd);
        expect(JSON.parse(out)).toHaveLength(1);
        expect(JSON.parse(out)[0].polarity).toBe('win');
    });

    test('recurring reports clusters at or above --min', () => {
        for (const _ of [0, 1]) {
            run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
                 '--signature', 'dup', '--severity', 'minor', '--desc', 'x'], cwd);
        }
        const out = run(['recurring', '--branch', 'feat-x', '--min', '2'], cwd);
        expect(JSON.parse(out)).toMatchObject([{ signature: 'dup', count: 2 }]);
    });

    test('archive removes the active ledger', () => {
        run(['add', '--branch', 'feat-x', '--polarity', 'finding', '--class', 'logica',
             '--signature', 's', '--severity', 'minor', '--desc', 'x'], cwd);
        run(['archive', '--branch', 'feat-x'], cwd);
        expect(listEntries(cwd, 'feat-x')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest --runInBand tests/commands/ledger/index.test.ts`
Expected: FAIL — `Cannot find module '../../../src/commands/ledger'`.

- [ ] **Step 3: Write the command**

Create `cli/src/commands/ledger/index.ts`:

```ts
import { Command } from 'commander';
import { addEntry, listEntries, recurring, archiveLedger, detectBranch } from '../../core/ledger/store';
import type { LedgerEntry, Polarity, LedgerClass, Severity } from '../../core/ledger/types';

interface AddOpts {
    branch?: string; polarity: Polarity; class: LedgerClass; signature: string;
    severity: Severity; desc: string; ref?: string; phase?: string; sourceSkill?: string;
}

/** YYYYMMDDThhmmss — filename-safe archive label derived from the current time. */
function archiveLabel(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
}

export function registerLedgerCommand(program: Command): void {
    const ledger = program.command('ledger').description('persistent per-branch findings ledger (working memory for harness-retro)');

    ledger
        .command('add')
        .description('append a finding or win to the current branch ledger')
        .requiredOption('--polarity <polarity>', 'win | finding')
        .requiredOption('--class <class>', 'structural | logica | proceso | seguridad')
        .requiredOption('--signature <slug>', 'dedup key for recurrence grouping')
        .requiredOption('--severity <severity>', 'blocker | important | minor | info')
        .requiredOption('--desc <text>', 'one-line description')
        .option('--ref <ref>', 'file:line or PR/commit reference')
        .option('--phase <phase>', 'lifecycle phase', 'unknown')
        .option('--source-skill <skill>', 'emitting skill', 'unknown')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: AddOpts) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            const entry: LedgerEntry = {
                ts: new Date().toISOString(),
                branch,
                phase: opts.phase ?? 'unknown',
                source_skill: opts.sourceSkill ?? 'unknown',
                polarity: opts.polarity,
                class: opts.class,
                signature: opts.signature,
                severity: opts.severity,
                desc: opts.desc,
                ref: opts.ref,
            };
            addEntry(cwd, entry);
        });

    ledger
        .command('list')
        .description('print the current branch ledger as JSON')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: { branch?: string }) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            process.stdout.write(JSON.stringify(listEntries(cwd, branch), null, 2) + '\n');
        });

    ledger
        .command('recurring')
        .description('print signature clusters with count >= min (recurrence signal)')
        .option('--min <n>', 'minimum occurrences', '2')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: { min: string; branch?: string }) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            const min = Number.parseInt(opts.min, 10) || 2;
            process.stdout.write(JSON.stringify(recurring(cwd, branch, min), null, 2) + '\n');
        });

    ledger
        .command('archive')
        .description('rotate the current branch ledger out of the active flow')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: { branch?: string }) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            const moved = archiveLedger(cwd, branch, archiveLabel());
            process.stdout.write(JSON.stringify({ archived: moved, branch }, null, 2) + '\n');
        });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest --runInBand tests/commands/ledger/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the command into the CLI entrypoint**

In `cli/src/index.ts`, near the existing `import { registerSensorsCommand } from './commands/sensors';` (line ~23), add:

```ts
import { registerLedgerCommand } from './commands/ledger';
```

Then find where `registerSensorsCommand(program)` is called and add directly after it:

```ts
registerLedgerCommand(program);
```

- [ ] **Step 6: Verify the build + full suite**

Run: `cd cli && npx tsc --noEmit && npx jest --runInBand`
Expected: tsc clean; full suite PASS (existing + new ledger tests).

- [ ] **Step 7: Smoke-test the real CLI**

Run:
```bash
cd cli && npx ts-node src/index.ts ledger add --branch smoke --polarity finding --class logica --signature smoke-sig --severity minor --desc "smoke" && npx ts-node src/index.ts ledger recurring --branch smoke --min 1
```
Expected: `recurring` prints a cluster `{ "signature": "smoke-sig", "count": 1 }`. Then clean up: `rm -rf .awm/ledger`.

- [ ] **Step 8: Commit**

```bash
git add cli/src/commands/ledger/index.ts cli/src/index.ts cli/tests/commands/ledger/index.test.ts
git commit -m "feat(ledger): awm ledger add/list/recurring/archive CLI (B-3 #1)"
```

---

## Task 4: Verify `.awm/ledger/` is gitignored (Component 5)

**Files:**
- Test: `cli/tests/core/ledger/gitignore.test.ts`
- Modify (only if the assertion fails): `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/core/ledger/gitignore.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

test('.awm (and therefore .awm/ledger) is gitignored — raw ledger never committed', () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '../../../../.gitignore'), 'utf-8');
    const lines = gitignore.split('\n').map(l => l.trim());
    const coversAwm = lines.includes('.awm') || lines.includes('.awm/') || lines.includes('.awm/ledger') || lines.includes('.awm/ledger/');
    expect(coversAwm).toBe(true);
});
```

- [ ] **Step 2: Run test**

Run: `cd cli && npx jest --runInBand tests/core/ledger/gitignore.test.ts`
Expected: PASS immediately — `.gitignore` line 5 already contains `.awm`. (If it FAILS, add a line `.awm/ledger/` to the repo-root `.gitignore` and re-run.)

> The raw ledger is working memory, not a committed artifact. `.awm` being ignored already satisfies Component 5's gitignore requirement; this test locks it so a future `.gitignore` edit can't silently start committing raw findings.

- [ ] **Step 3: Commit**

```bash
git add cli/tests/core/ledger/gitignore.test.ts
git commit -m "test(ledger): lock .awm/ledger gitignore — raw ledger stays out of git (B-3 #5)"
```

---

## Task 5: Rewrite `harness-retro` — ledger-driven + interactive + two-tier curation

**Files:**
- Modify: `registry/skills/harness-retro/SKILL.md`
- Test: `cli/tests/registry/b3-ledger-wiring.test.ts` (harness-retro section)

- [ ] **Step 1: Write the failing test**

Create `cli/tests/registry/b3-ledger-wiring.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const REG = path.join(__dirname, '../../../registry/skills');
const read = (p: string) => fs.readFileSync(path.join(REG, p), 'utf-8');

describe('B-3 harness-retro is ledger-driven', () => {
    const skill = read('harness-retro/SKILL.md');

    test('reads the ledger via awm ledger list + recurring', () => {
        expect(skill).toMatch(/awm ledger list/);
        expect(skill).toMatch(/awm ledger recurring/);
    });

    test('archives the ledger when done', () => {
        expect(skill).toMatch(/awm ledger archive/);
    });

    test('no longer relies on the human "where did this fail before?" memory step', () => {
        expect(skill).not.toMatch(/Where did this pattern fail before\?/);
    });

    test('cures into AGENTS.md (agnostic) for agent-style lessons + wins, not CLAUDE.md', () => {
        expect(skill).toMatch(/AGENTS\.md/);
    });

    test('writes the awm-retro-complete marker', () => {
        expect(skill).toMatch(/awm-retro-complete/);
    });

    test('treats recurrence as a signal, not a hard >=2 gate (interactive decision)', () => {
        expect(skill).toMatch(/se(ñ|n)al|signal/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest --runInBand tests/registry/b3-ledger-wiring.test.ts -t "ledger-driven"`
Expected: FAIL — current `harness-retro/SKILL.md` has the human memory step and no `awm ledger` references.

- [ ] **Step 3: Rewrite the skill**

Edit `registry/skills/harness-retro/SKILL.md`. Make these concrete changes (keep the remediation tree and classification heuristics intact):

1. **Frontmatter `description`** — replace with:
```
description: Use as the terminal learning phase of development-process — reads the per-branch findings ledger (awm ledger), presents the session's findings and wins, and interactively cures each into a concrete, durable rule (remediation tree / CONSTITUTION.md / AGENTS.md) so the agent stops repeating mistakes. Ledger-driven, not dependent on human recall.
```

2. **Overview** — add after the existing principle line:
```
**Source of truth:** the per-branch ledger at `.awm/ledger/<branch>.jsonl`, populated during the session by the review/QA/sensor/debugging phases. harness-retro reads it; it does not ask you to remember prior occurrences.
```

3. **Replace Checklist step 1** ("Confirm recurrence — ≥2 occurrences…") with:
```
1. **Read the session ledger** — run `awm ledger list` (all findings + wins for this branch) and `awm ledger recurring --min 2` (recurrence signal). Recurrence count is a **signal to weigh, not a hard gate** — you may structuralize a single high-impact finding, or defer a recurring trivial one. The user decides.
```

4. **Replace the Process "### 1. Confirm recurrence"** section (which asks "Where did this pattern fail before?") with a "### 1. Read the session ledger" section that runs the two `awm ledger` commands and summarizes findings + wins. Remove the "If the user can't name two instances…" guidance.

5. **Add a curation-target table** to the remediation step, replacing the old class→target table with the two-tier version:
```
| Class | Cured target (existing, delivered) |
|---|---|
| structural / seguridad / lógica (sensor-catchable) | remediation tree: `eslint.config.awm.mjs` / `.semgrep.awm.yml` / `tests/structural/` |
| de proceso (project rule) | `CONSTITUTION.md` |
| agent working-style + **wins** | `AGENTS.md` |
```
Add prose: wins (`polarity: win`) are reinforced as short "what works here" notes in `AGENTS.md`. Agent-style lessons land in `AGENTS.md` (agnostic — every agent reads it), never `CLAUDE.md`.

6. **Add a "Cure, don't append raw" instruction** near the apply step:
```
When writing to `CONSTITUTION.md` / `AGENTS.md`, **merge and prune**: fold the new lesson into the relevant existing section and drop entries that no longer apply. These docs are delivered every session — keep them a curated index, not an append-only log, so context never saturates.
```

7. **Present-to-user step** — make it explicitly interactive over the full ledger:
```
Present every ledger item — findings AND wins — grouped by signature with its recurrence count. For each, the user chooses: structuralize (which target), record as an AGENTS.md lesson/win, or dismiss (note the reason). Wait for explicit decisions before applying.
```

8. **Add a final step** after the existing "Log the retro" step:
```
### N. Close the retro

Run `awm ledger archive` to rotate this branch's ledger out of the active flow (it stays on disk under `.awm/ledger/archive/` for audit; the next plan starts fresh).

Then add the completion marker to the active plan (first line after the `#` header), so `development-process` routes to `finishing-a-development-branch`:

    <!-- awm-retro-complete: YYYY-MM-DD -->
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest --runInBand tests/registry/b3-ledger-wiring.test.ts -t "ledger-driven"`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add registry/skills/harness-retro/SKILL.md cli/tests/registry/b3-ledger-wiring.test.ts
git commit -m "feat(harness-retro): ledger-driven + interactive + two-tier curation (B-3 #3)"
```

---

## Task 6: Wire capture into the finding-producing phases (errors + wins)

**Files:**
- Modify: `registry/skills/subagent-driven-development/spec-reviewer-prompt.md`
- Modify: `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`
- Modify: `registry/skills/post-implementation-qa/deep-review-prompt.md`
- Modify: `registry/skills/post-implementation-qa/SKILL.md`
- Modify: `registry/skills/verification-before-completion/SKILL.md`
- Modify: `registry/skills/systematic-debugging/SKILL.md`
- Test: `cli/tests/registry/b3-ledger-wiring.test.ts` (capture section)

- [ ] **Step 1: Write the failing test**

Append to `cli/tests/registry/b3-ledger-wiring.test.ts`:

```ts
describe('B-3 capture wiring — phases append to the ledger', () => {
    test('SDD spec reviewer emits findings AND wins to the ledger', () => {
        const p = read('subagent-driven-development/spec-reviewer-prompt.md');
        expect(p).toMatch(/awm ledger add/);
        expect(p).toMatch(/--polarity (win|finding)/);
        expect(p).toMatch(/--polarity win/);
    });

    test('SDD code-quality reviewer emits findings AND wins to the ledger', () => {
        const p = read('subagent-driven-development/code-quality-reviewer-prompt.md');
        expect(p).toMatch(/awm ledger add/);
        expect(p).toMatch(/--polarity win/);
    });

    test('post-qa deep-review emits findings AND wins to the ledger', () => {
        const p = read('post-implementation-qa/deep-review-prompt.md');
        expect(p).toMatch(/awm ledger add/);
        expect(p).toMatch(/--polarity win/);
    });

    test('verification-before-completion logs recurring sensor failures', () => {
        const p = read('verification-before-completion/SKILL.md');
        expect(p).toMatch(/awm ledger add/);
    });

    test('systematic-debugging logs the confirmed root cause', () => {
        const p = read('systematic-debugging/SKILL.md');
        expect(p).toMatch(/awm ledger add/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest --runInBand tests/registry/b3-ledger-wiring.test.ts -t "capture wiring"`
Expected: FAIL — none of the prompts mention `awm ledger add` yet.

- [ ] **Step 3: Wire the SDD spec reviewer**

In `registry/skills/subagent-driven-development/spec-reviewer-prompt.md`, add a section near where the reviewer reports its verdict:

```markdown
## Record to the ledger (AWM)

After forming your verdict, persist each result to the branch ledger so harness-retro can learn from this session. One command per item:

- For each spec gap (missing / extra / misread):
  `awm ledger add --phase spec-review --source-skill subagent-driven-development --polarity finding --class proceso --signature <short-slug> --severity <blocker|important|minor> --desc "<one line>" --ref <file:line>`
- For each thing the implementer did **well** (a win worth reinforcing):
  `awm ledger add --phase spec-review --source-skill subagent-driven-development --polarity win --class proceso --signature <short-slug> --severity info --desc "<one line>"`

Use a stable, lowercase `--signature` slug (e.g. `missing-progress-reporting`) so recurring issues group across sessions. If `awm` is not on PATH, skip silently — the ledger is best-effort.
```

- [ ] **Step 4: Wire the SDD code-quality reviewer**

In `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`, add the same "## Record to the ledger (AWM)" section, but with `--phase code-quality-review` and class chosen by the finding nature (`structural` for type/shape issues, `logica` for behavioral, `seguridad` for vulnerabilities). Include the same findings-and-wins pair and the same best-effort note.

- [ ] **Step 5: Wire the post-qa deep-review**

In `registry/skills/post-implementation-qa/deep-review-prompt.md`, add a "## Record to the ledger (AWM)" section instructing: after classifying findings, emit one `awm ledger add --phase post-qa --source-skill post-implementation-qa ...` per Type B finding (`--class proceso`) and per Type C finding (`--class logica` or `seguridad`), plus `--polarity win` entries for invariants the implementation got right. Same signature/best-effort guidance.

Then in `registry/skills/post-implementation-qa/SKILL.md`, in "### Paso 3: Dispatch del subagente de revisión profunda", add a bullet: *"El subagente además registra cada hallazgo y win en el ledger vía `awm ledger add` (ver deep-review-prompt.md), insumo de `harness-retro`."*

- [ ] **Step 6: Wire verification-before-completion**

In `registry/skills/verification-before-completion/SKILL.md`, where it covers a sensor failing again (the recurring-sensor trigger), add:

```markdown
When a sensor failure recurs (same `name` + `rule` as a prior fix), log it before fixing so the recurrence is counted:

`awm ledger add --phase sensors --source-skill verification-before-completion --polarity finding --class structural --signature <sensor>:<rule> --severity important --desc "<sensor> recurred on <rule>"`

(Best-effort — skip if `awm` is unavailable.)
```

- [ ] **Step 7: Wire systematic-debugging**

In `registry/skills/systematic-debugging/SKILL.md`, where the root cause is confirmed, add:

```markdown
On confirmed root cause, record it to the ledger so a second occurrence is detectable:

`awm ledger add --phase debugging --source-skill systematic-debugging --polarity finding --class <structural|logica|seguridad> --signature <root-cause-slug> --severity <blocker|important> --desc "<root cause, one line>" --ref <file:line>`

(Best-effort — skip if `awm` is unavailable.)
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd cli && npx jest --runInBand tests/registry/b3-ledger-wiring.test.ts -t "capture wiring"`
Expected: PASS (5 assertions).

- [ ] **Step 9: Commit**

```bash
git add registry/skills/subagent-driven-development/spec-reviewer-prompt.md \
        registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md \
        registry/skills/post-implementation-qa/deep-review-prompt.md \
        registry/skills/post-implementation-qa/SKILL.md \
        registry/skills/verification-before-completion/SKILL.md \
        registry/skills/systematic-debugging/SKILL.md \
        cli/tests/registry/b3-ledger-wiring.test.ts
git commit -m "feat(skills): capture findings+wins to the ledger across review/qa/sensors/debug (B-3 #2)"
```

---

## Task 7: `development-process` — harness-retro as terminal phase

**Files:**
- Modify: `registry/skills/development-process/SKILL.md`
- Test: `cli/tests/registry/b3-ledger-wiring.test.ts` (dev-process section)

- [ ] **Step 1: Write the failing test**

Append to `cli/tests/registry/b3-ledger-wiring.test.ts`:

```ts
describe('B-3 development-process routes harness-retro as a terminal phase', () => {
    const skill = read('development-process/SKILL.md');

    test('harness-retro appears as a pipeline phase between QA and finishing', () => {
        const qaIdx = skill.indexOf('post-implementation-qa');
        const retroIdx = skill.indexOf('harness-retro');
        const finishIdx = skill.indexOf('finishing-a-development-branch');
        expect(retroIdx).toBeGreaterThan(-1);
        expect(qaIdx).toBeLessThan(retroIdx);
        expect(retroIdx).toBeLessThan(finishIdx);
    });

    test('routing keys on the awm-retro-complete marker', () => {
        expect(skill).toMatch(/awm-retro-complete/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest --runInBand tests/registry/b3-ledger-wiring.test.ts -t "terminal phase"`
Expected: FAIL — `development-process/SKILL.md` does not mention `harness-retro` or `awm-retro-complete`.

- [ ] **Step 3: Wire development-process**

In `registry/skills/development-process/SKILL.md`:

1. In the lifecycle digraph, change the QA→finishing edge to route through harness-retro:
```
    "harness-retro" [shape=box, style=filled, fillcolor=lightyellow, label="harness-retro"];
    "post-implementation-qa" -> "harness-retro";
    "harness-retro" -> "finishing-a-development-branch";
```
(remove the direct `"post-implementation-qa" -> "finishing-a-development-branch";` edge.)

2. In the "Pipeline Skills" table, insert a row between QA (4) and Completion (5):
```
| 4.5. Retro | `harness-retro` | QA complete (`awm-qa-complete`), retro not yet done (`awm-retro-complete` absent) | Lessons cured into remediation tree / CONSTITUTION.md / AGENTS.md; ledger archived; marker `awm-retro-complete` |
```
Renumber Completion to phase 5 and update its trigger to `awm-retro-complete present`.

3. In "Step 1: Identify Project State", add a row to the state table and adjust the finishing row:
```
| `*-plan.md` all tasks complete, `awm-qa-complete` present, no `awm-retro-complete` | **Retro pending** | Invoke `harness-retro` |
| `*-plan.md` all tasks complete, `awm-retro-complete` present | **Finishing** | Invoke `finishing-a-development-branch` |
```

4. In "Decision Rules → When all plan tasks are complete but QA marker is absent", add a sibling rule:
```
### When QA is complete but the retro marker is absent
1. Check the plan for `<!-- awm-retro-complete`
2. If absent → invoke `harness-retro` (it always runs; if the ledger is empty it exits fast and routes to finishing)
3. Do NOT jump to `finishing-a-development-branch` without the retro marker
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest --runInBand tests/registry/b3-ledger-wiring.test.ts -t "terminal phase"`
Expected: PASS (2 assertions).

- [ ] **Step 5: Full regression + sensors gate**

Run:
```bash
cd cli && npx tsc --noEmit && npx jest --runInBand && awm sensors run
```
Expected: tsc clean; full suite green; `awm sensors run` `overall: pass` (the known pre-existing `depcheck` false-positive is out of scope — note it if it appears, do not let it block).

- [ ] **Step 6: Commit**

```bash
git add registry/skills/development-process/SKILL.md cli/tests/registry/b3-ledger-wiring.test.ts
git commit -m "feat(development-process): harness-retro as terminal phase before finishing (B-3 #4)"
```

---

## Self-Review notes (author)

- **Spec coverage:** Component 1 → T1–T3; Component 2 → T6; Component 3 → T5; Component 4 → T7; Component 5 → T4 (gitignore) + T5 (prune prose). All five design components map to tasks.
- **Type consistency:** `LedgerEntry` fields (`ts`, `branch`, `phase`, `source_skill`, `polarity`, `class`, `signature`, `severity`, `desc`, `ref`) are used identically across `types.ts`, `store.ts`, the CLI command, and the test fixtures. `recurring()` returns `RecurringCluster[]` with `{ signature, count, entries }` consistently.
- **Determinism in tests:** `ts` is stamped by the CLI layer (`new Date().toISOString()`); store-level tests pass a fixed `ts`, and the archive label is injected (`archiveLedger(cwd, branch, label)`) so no test depends on wall-clock.
- **Best-effort capture:** every skill-prose `awm ledger add` instruction says skip silently if `awm` is unavailable — the ledger never blocks a review.
- **Agnosticism (B-1):** curation routes agent-style lessons + wins to `AGENTS.md`, not `CLAUDE.md`; tests assert `AGENTS.md` presence.
