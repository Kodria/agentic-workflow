# AWM `list` / `add` UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat ~54-item multiselect in `awm add` with a 2-level drill-down, and turn `awm list` into a compact summary with on-demand detail, both fed by a shared package-view model with frontmatter descriptions.

**Architecture:** A new pure module `utils/registry-view.ts` builds a `PackageView[]` model from discovered artifacts + `processes.json`, including a synthetic `standalone` package and frontmatter-sourced descriptions. `awm list` and `awm add` consume this model through small pure helpers (formatters / option builders / selection resolvers) that are unit-tested; the interactive `@clack/prompts` glue stays thin. The old `utils/grouping.ts` is removed.

**Tech Stack:** TypeScript, `@clack/prompts@1.0.1` (`multiselect`/`select`), `commander`, `picocolors`, Jest + ts-jest.

**Working branch:** `feat/awm-list-add-ux` (already created).

---

## Key implementation facts (read before starting)

- **Registry layout** (`core/discovery.ts`): skills are directories containing `SKILL.md`; workflows/agents are `.md` files. `processes.json` is an array of `{ name, description, skills[], workflows[], agents? }`.
- **Install naming** (current `add` flow, `index.ts:130-163`): a skill installs under its directory name (`s.name`); a workflow/agent installs as `${name}.md`. The install loop reads `artifact.name` (the on-disk name), `artifact.sourcePath`, `artifact.type`, and skips when `PROVIDERS[agent][type] === null`.
- **`@clack@1.0.1` rendering** (verified in `node_modules/@clack/prompts/dist/index.mjs`): in `multiselect`, an option's `hint` is rendered **only while that row is focused**; the `label` is always rendered verbatim. Therefore always-visible descriptions MUST be embedded in the `label` string (with an explicit `\n` + manual indentation), NOT in `hint`.
- **Tests** run with `npm test` (`jest --runInBand`) from `cli/`. `testMatch` is `**/tests/**/*.test.ts`. Run one file with `npx jest tests/<path>`.
- `tests/core/discovery.test.ts` mocks `fs` globally — new code must tolerate `fs.readFileSync` returning `undefined`.

## File Structure

- **Create** `cli/src/utils/registry-view.ts` — `ArtifactView`/`PackageView` types, `buildPackageView`, list formatters, add option-builders + selection resolver, shared constants/icons.
- **Create** `cli/tests/utils/registry-view.test.ts` — unit tests for the above.
- **Modify** `cli/src/core/discovery.ts` — add `description` to artifact interfaces, populate it, export `readArtifactDescription`.
- **Modify** `cli/tests/core/discovery.test.ts` — add `readArtifactDescription` tests.
- **Modify** `cli/src/index.ts` — rewrite `add` artifact-selection step and the whole `list` command; drop `grouping`/`resolveSelectedArtifacts` usage.
- **Delete** `cli/src/utils/grouping.ts` and `cli/tests/utils/grouping.test.ts`.

---

## Task 1: Frontmatter descriptions in discovery

**Files:**
- Modify: `cli/src/core/discovery.ts`
- Test: `cli/tests/core/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `cli/tests/core/discovery.test.ts` (inside the top-level `describe`, after the existing blocks). Update the import on line 1 to include `readArtifactDescription`:

```ts
// line 1 becomes:
import { discoverSkills, discoverWorkflows, discoverProcesses, readArtifactDescription, SKILLS_DIR, WORKFLOWS_DIR, PROCESSES_FILE } from '../../src/core/discovery';
```

```ts
    describe('readArtifactDescription', () => {
        it('extracts the description field from YAML frontmatter', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue(
                '---\nname: my-skill\ndescription: Does a useful thing\n---\n\n# Body\n'
            );
            expect(readArtifactDescription('/any/SKILL.md')).toBe('Does a useful thing');
        });

        it('strips surrounding quotes from the description', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue(
                '---\ndescription: "Quoted desc"\n---\n'
            );
            expect(readArtifactDescription('/any/SKILL.md')).toBe('Quoted desc');
        });

        it('returns empty string when there is no frontmatter', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue('# Just a heading\n');
            expect(readArtifactDescription('/any/SKILL.md')).toBe('');
        });

        it('returns empty string when description is absent', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue('---\nname: x\n---\n');
            expect(readArtifactDescription('/any/SKILL.md')).toBe('');
        });

        it('returns empty string when the file cannot be read', () => {
            (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
            expect(readArtifactDescription('/missing/SKILL.md')).toBe('');
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/discovery.test.ts -t readArtifactDescription`
Expected: FAIL — `readArtifactDescription is not a function` / not exported.

- [ ] **Step 3: Implement `readArtifactDescription` and add `description` to interfaces**

In `cli/src/core/discovery.ts`, add the `description` field to the three artifact interfaces:

```ts
export interface SkillArtifact {
    name: string;
    path: string;
    description: string;
}

export interface WorkflowArtifact {
    name: string;
    path: string;
    description: string;
}

export interface AgentArtifact {
    name: string;
    path: string;
    description: string;
}
```

Add the helper (place it just above `discoverSkills`):

```ts
/**
 * Reads the `description:` field from a markdown file's YAML frontmatter.
 * Returns '' when the file is unreadable, has no frontmatter, or has no
 * description. Single-line descriptions only (the format used by SKILL.md).
 */
export function readArtifactDescription(filePath: string): string {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fmMatch) return '';
        const line = fmMatch[1]
            .split(/\r?\n/)
            .find((l) => /^description\s*:/.test(l));
        if (!line) return '';
        let val = line.replace(/^description\s*:/, '').trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        return val.trim();
    } catch {
        return '';
    }
}
```

Populate `description` in each discover function's `.map(...)`:

```ts
// discoverSkills map:
        .map((entry) => ({
            name: entry.name,
            path: path.join(SKILLS_DIR, entry.name),
            description: readArtifactDescription(path.join(SKILLS_DIR, entry.name, 'SKILL.md')),
        }));

// discoverWorkflows map:
        .map((entry) => ({
            name: entry.name.replace('.md', ''),
            path: path.join(WORKFLOWS_DIR, entry.name),
            description: readArtifactDescription(path.join(WORKFLOWS_DIR, entry.name)),
        }));

// discoverAgents map:
        .map((entry) => ({
            name: entry.name.replace('.md', ''),
            path: path.join(AGENTS_DIR, entry.name),
            description: readArtifactDescription(path.join(AGENTS_DIR, entry.name)),
        }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/discovery.test.ts`
Expected: PASS — all `readArtifactDescription` tests pass and the pre-existing `discoverSkills`/`discoverWorkflows`/`discoverProcesses` tests still pass (description resolves to `''` under the global `fs` mock).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/discovery.ts cli/tests/core/discovery.test.ts
git commit -m "feat(discovery): read description from artifact frontmatter"
```

---

## Task 2: `buildPackageView` model

**Files:**
- Create: `cli/src/utils/registry-view.ts`
- Test: `cli/tests/utils/registry-view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/tests/utils/registry-view.test.ts`:

```ts
import { buildPackageView, STANDALONE_NAME } from '../../src/utils/registry-view';
import { SkillArtifact, WorkflowArtifact, AgentArtifact, ProcessDefinition } from '../../src/core/discovery';

const skill = (name: string, description = ''): SkillArtifact => ({ name, path: `/s/${name}`, description });
const wf = (name: string, description = ''): WorkflowArtifact => ({ name, path: `/w/${name}.md`, description });
const agent = (name: string, description = ''): AgentArtifact => ({ name, path: `/a/${name}.md`, description });

const processes: ProcessDefinition[] = [
    { name: 'core-dev', description: 'Dev lifecycle', skills: ['brainstorming', 'shared'], workflows: ['exec'], agents: ['plan'] },
    { name: 'docs', description: 'Docs as code', skills: ['shared'], workflows: [], agents: [] },
];

describe('buildPackageView', () => {
    it('groups artifacts under their package with correct counts and install names', () => {
        const view = buildPackageView(
            [skill('brainstorming', 'explore'), skill('shared')],
            [wf('exec')],
            [agent('plan')],
            processes
        );
        const core = view.find((p) => p.name === 'core-dev')!;
        expect(core.description).toBe('Dev lifecycle');
        expect(core.counts).toEqual({ skills: 2, workflows: 1, agents: 1 });
        expect(core.artifacts.find((a) => a.type === 'skill' && a.name === 'brainstorming')!.installName).toBe('brainstorming');
        expect(core.artifacts.find((a) => a.type === 'workflow')!.installName).toBe('exec.md');
        expect(core.artifacts.find((a) => a.type === 'agent')!.installName).toBe('plan.md');
        expect(core.artifacts.find((a) => a.name === 'brainstorming')!.description).toBe('explore');
    });

    it('places an artifact that belongs to two packages in both', () => {
        const view = buildPackageView([skill('shared')], [], [], processes);
        const names = view.map((p) => p.name);
        expect(names).toContain('core-dev');
        expect(names).toContain('docs');
    });

    it('collects orphan artifacts into a standalone package', () => {
        const view = buildPackageView([skill('orphan')], [], [], processes);
        const standalone = view.find((p) => p.name === STANDALONE_NAME)!;
        expect(standalone.isStandalone).toBe(true);
        expect(standalone.artifacts.map((a) => a.name)).toEqual(['orphan']);
    });

    it('omits empty packages and omits standalone when there are no orphans', () => {
        const view = buildPackageView([skill('brainstorming')], [], [], processes);
        expect(view.map((p) => p.name)).toEqual(['core-dev']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts`
Expected: FAIL — cannot find module `../../src/utils/registry-view`.

- [ ] **Step 3: Implement the model**

Create `cli/src/utils/registry-view.ts`:

```ts
import { ArtifactType } from '../providers';
import { ProcessDefinition, SkillArtifact, WorkflowArtifact, AgentArtifact } from '../core/discovery';

export const STANDALONE_NAME = 'standalone';

export interface ArtifactView {
    name: string;          // baseName (no extension)
    type: ArtifactType;    // 'skill' | 'workflow' | 'agent'
    sourcePath: string;    // path to install from
    installName: string;   // on-disk name at the destination
    description: string;   // from frontmatter; '' when absent
}

export interface PackageView {
    name: string;
    description: string;
    isStandalone: boolean;
    artifacts: ArtifactView[];
    counts: { skills: number; workflows: number; agents: number };
}

function makePackage(name: string, description: string, isStandalone: boolean, artifacts: ArtifactView[]): PackageView {
    return {
        name,
        description,
        isStandalone,
        artifacts,
        counts: {
            skills: artifacts.filter((a) => a.type === 'skill').length,
            workflows: artifacts.filter((a) => a.type === 'workflow').length,
            agents: artifacts.filter((a) => a.type === 'agent').length,
        },
    };
}

/**
 * Builds the package-grouped view consumed by `awm list` and `awm add`.
 * - An artifact may appear in multiple packages (mirrors processes.json).
 * - Artifacts in no package are collected into a synthetic `standalone` package.
 * - Empty packages are omitted; standalone is omitted when there are no orphans.
 */
export function buildPackageView(
    skills: SkillArtifact[],
    workflows: WorkflowArtifact[],
    agents: AgentArtifact[],
    processes: ProcessDefinition[]
): PackageView[] {
    const all: ArtifactView[] = [
        ...skills.map((s) => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path, installName: s.name, description: s.description ?? '' })),
        ...workflows.map((w) => ({ name: w.name, type: 'workflow' as ArtifactType, sourcePath: w.path, installName: `${w.name}.md`, description: w.description ?? '' })),
        ...agents.map((a) => ({ name: a.name, type: 'agent' as ArtifactType, sourcePath: a.path, installName: `${a.name}.md`, description: a.description ?? '' })),
    ];

    const packages: PackageView[] = [];
    const claimed = new Set<ArtifactView>();

    for (const p of processes) {
        const arts = all.filter((a) =>
            (a.type === 'skill' && p.skills.includes(a.name)) ||
            (a.type === 'workflow' && p.workflows.includes(a.name)) ||
            (a.type === 'agent' && (p.agents ?? []).includes(a.name))
        );
        if (arts.length === 0) continue;
        arts.forEach((a) => claimed.add(a));
        packages.push(makePackage(p.name, p.description, false, arts));
    }

    const orphans = all.filter((a) => !claimed.has(a));
    if (orphans.length > 0) {
        packages.push(makePackage(STANDALONE_NAME, 'Artifacts not part of any package', true, orphans));
    }

    return packages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils/registry-view.ts cli/tests/utils/registry-view.test.ts
git commit -m "feat(registry-view): shared package-view model for list and add"
```

---

## Task 3: List formatters + package lookup

**Files:**
- Modify: `cli/src/utils/registry-view.ts`
- Test: `cli/tests/utils/registry-view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cli/tests/utils/registry-view.test.ts`:

```ts
import { packageSummaryLines, packageDetailLines, findPackage, artifactCountLabel } from '../../src/utils/registry-view';

describe('artifactCountLabel', () => {
    it('labels a skills-only package', () => {
        expect(artifactCountLabel({ skills: 30, workflows: 0, agents: 0 })).toBe('30 skills');
    });
    it('singularizes one skill', () => {
        expect(artifactCountLabel({ skills: 1, workflows: 0, agents: 0 })).toBe('1 skill');
    });
    it('appends workflow and agent counts when present', () => {
        expect(artifactCountLabel({ skills: 2, workflows: 1, agents: 1 })).toBe('2 skills · 1 workflow · 1 agent');
    });
});

describe('packageSummaryLines', () => {
    it('renders one aligned line per package plus a header count', () => {
        const view = buildPackageView(
            [skill('brainstorming'), skill('shared')],
            [],
            [],
            processes
        );
        const lines = packageSummaryLines(view);
        expect(lines[0]).toContain('2 packages');
        expect(lines.some((l) => l.includes('core-dev') && l.includes('Dev lifecycle'))).toBe(true);
        expect(lines.some((l) => l.includes('docs'))).toBe(true);
    });
});

describe('packageDetailLines', () => {
    it('lists each artifact and its description', () => {
        const view = buildPackageView([skill('brainstorming', 'explore intent')], [], [], processes);
        const core = view.find((p) => p.name === 'core-dev')!;
        const lines = packageDetailLines(core).join('\n');
        expect(lines).toContain('core-dev');
        expect(lines).toContain('brainstorming');
        expect(lines).toContain('explore intent');
    });
});

describe('findPackage', () => {
    const view = buildPackageView([skill('brainstorming')], [], [], processes);
    it('matches by exact name (case-insensitive)', () => {
        expect(findPackage(view, 'Core-Dev').match!.name).toBe('core-dev');
    });
    it('suggests the closest package on a miss', () => {
        const res = findPackage(view, 'cor');
        expect(res.match).toBeUndefined();
        expect(res.suggestion).toBe('core-dev');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts -t 'packageSummaryLines|packageDetailLines|findPackage|artifactCountLabel'`
Expected: FAIL — these functions are not exported.

- [ ] **Step 3: Implement formatters + lookup**

Append to `cli/src/utils/registry-view.ts`:

```ts
const TYPE_ICON: Record<ArtifactType, string> = { skill: '', workflow: '⚡ ', agent: '🤖 ' };

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Human label for a package's contents, e.g. "2 skills · 1 workflow". */
export function artifactCountLabel(counts: PackageView['counts']): string {
    const parts: string[] = [];
    if (counts.skills > 0) parts.push(plural(counts.skills, 'skill'));
    if (counts.workflows > 0) parts.push(plural(counts.workflows, 'workflow'));
    if (counts.agents > 0) parts.push(plural(counts.agents, 'agent'));
    if (parts.length === 0) return '0 artifacts';
    return parts.join(' · ');
}

function packageIcon(pkg: PackageView): string {
    return pkg.isStandalone ? '🔹' : '📦';
}

/** Compact summary: a header line plus one aligned line per package. */
export function packageSummaryLines(packages: PackageView[]): string[] {
    const totalSkills = packages.reduce((n, p) => n + p.counts.skills, 0);
    const lines: string[] = [`AWM Registry — ${plural(packages.length, 'package')}, ${plural(totalSkills, 'skill')}`, ''];

    const nameWidth = Math.max(0, ...packages.map((p) => p.name.length));
    const countLabels = packages.map((p) => (p.isStandalone ? plural(p.artifacts.length, 'artifact') : artifactCountLabel(p.counts)));
    const countWidth = Math.max(0, ...countLabels.map((c) => c.length));

    packages.forEach((p, i) => {
        const name = p.name.padEnd(nameWidth);
        const count = countLabels[i].padEnd(countWidth);
        const desc = p.isStandalone ? '' : p.description;
        lines.push(`${packageIcon(p)} ${name}   ${count}   ${desc}`.trimEnd());
    });
    return lines;
}

/** Detailed view of a single package: header + one or two lines per artifact. */
export function packageDetailLines(pkg: PackageView): string[] {
    const lines: string[] = [];
    const header = pkg.isStandalone
        ? `${packageIcon(pkg)} ${pkg.name} — ${plural(pkg.artifacts.length, 'artifact')}`
        : `${packageIcon(pkg)} ${pkg.name} — ${pkg.description}  [${artifactCountLabel(pkg.counts)}]`;
    lines.push(header);
    pkg.artifacts.forEach((a) => {
        lines.push(`  ${TYPE_ICON[a.type]}${a.name}`);
        if (a.description) lines.push(`     ${a.description}`);
    });
    return lines;
}

export interface PackageLookup {
    match?: PackageView;
    suggestion?: string;
}

/** Exact (case-insensitive) name match; otherwise the closest name as a suggestion. */
export function findPackage(packages: PackageView[], query: string): PackageLookup {
    const q = query.toLowerCase();
    const exact = packages.find((p) => p.name.toLowerCase() === q);
    if (exact) return { match: exact };

    // Closest: prefer substring containment, then longest shared prefix.
    const contains = packages.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
    if (contains) return { suggestion: contains.name };

    let best: PackageView | undefined;
    let bestPrefix = -1;
    for (const p of packages) {
        const name = p.name.toLowerCase();
        let i = 0;
        while (i < name.length && i < q.length && name[i] === q[i]) i++;
        if (i > bestPrefix) {
            bestPrefix = i;
            best = p;
        }
    }
    return { suggestion: best?.name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils/registry-view.ts cli/tests/utils/registry-view.test.ts
git commit -m "feat(registry-view): list formatters and package lookup"
```

---

## Task 4: Add option-builders + selection resolver

**Files:**
- Modify: `cli/src/utils/registry-view.ts`
- Test: `cli/tests/utils/registry-view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cli/tests/utils/registry-view.test.ts`:

```ts
import { ALL_SENTINEL, buildLevel1Options, buildLevel2Options, resolveLevel2Selection } from '../../src/utils/registry-view';

describe('buildLevel1Options', () => {
    it('produces one option per package keyed by package name', () => {
        const view = buildPackageView([skill('brainstorming'), skill('shared')], [], [], processes);
        const opts = buildLevel1Options(view);
        expect(opts.map((o) => o.value).sort()).toEqual(['core-dev', 'docs']);
        expect(opts.find((o) => o.value === 'core-dev')!.label).toContain('core-dev');
        expect(opts.find((o) => o.value === 'core-dev')!.label).toContain('Dev lifecycle');
    });
});

describe('buildLevel2Options', () => {
    it('puts an "install entire package" sentinel first, then one option per artifact', () => {
        const view = buildPackageView([skill('brainstorming', 'explore')], [wf('exec')], [agent('plan')], processes);
        const core = view.find((p) => p.name === 'core-dev')!;
        const opts = buildLevel2Options(core);
        expect(opts[0].value).toBe(ALL_SENTINEL);
        expect(opts[0].label).toContain('Install entire package');
        const values = opts.slice(1).map((o) => o.value);
        expect(values).toContain('skill:brainstorming');
        expect(values).toContain('workflow:exec');
        expect(values).toContain('agent:plan');
        // description embedded in the label (always-visible, multi-line)
        expect(opts.find((o) => o.value === 'skill:brainstorming')!.label).toContain('explore');
    });
});

describe('resolveLevel2Selection', () => {
    const view = buildPackageView([skill('brainstorming'), skill('shared')], [], [], processes);
    const core = view.find((p) => p.name === 'core-dev')!;

    it('returns all artifacts when the sentinel is selected', () => {
        const out = resolveLevel2Selection(core, [ALL_SENTINEL]);
        expect(out.map((a) => a.name).sort()).toEqual(['brainstorming', 'shared']);
    });

    it('returns only the cherry-picked artifacts otherwise', () => {
        const out = resolveLevel2Selection(core, ['skill:brainstorming']);
        expect(out.map((a) => a.name)).toEqual(['brainstorming']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts -t 'buildLevel1Options|buildLevel2Options|resolveLevel2Selection'`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement option-builders + resolver**

Append to `cli/src/utils/registry-view.ts` (add `import pc from 'picocolors';` at the top of the file):

```ts
export const ALL_SENTINEL = '__ALL__';

function artifactValue(a: ArtifactView): string {
    return `${a.type}:${a.name}`;
}

/** Level-1 multiselect options: one per package, value = package name. */
export function buildLevel1Options(packages: PackageView[]): { value: string; label: string }[] {
    return packages.map((p) => {
        const count = p.isStandalone ? plural(p.artifacts.length, 'artifact') : artifactCountLabel(p.counts);
        const desc = p.isStandalone ? '' : ` · ${p.description}`;
        return { value: p.name, label: `${packageIcon(p)} ${p.name}  ${pc.dim(`${count}${desc}`)}` };
    });
}

/**
 * Level-2 multiselect options for one package. First option is the
 * "install entire package" sentinel; the rest are one per artifact with the
 * description embedded into the label (always-visible — @clack hints only show
 * on the focused row).
 */
export function buildLevel2Options(pkg: PackageView): { value: string; label: string }[] {
    const installAll = { value: ALL_SENTINEL, label: `✨ Install entire package (${pkg.artifacts.length})` };
    const rest = pkg.artifacts.map((a) => {
        const title = `${TYPE_ICON[a.type]}${a.name}`;
        const label = a.description ? `${title}\n     ${pc.dim(a.description)}` : title;
        return { value: artifactValue(a), label };
    });
    return [installAll, ...rest];
}

/**
 * Maps a level-2 selection back to artifacts. The sentinel means "all".
 */
export function resolveLevel2Selection(pkg: PackageView, selectedValues: string[]): ArtifactView[] {
    if (selectedValues.includes(ALL_SENTINEL)) return [...pkg.artifacts];
    const wanted = new Set(selectedValues);
    return pkg.artifacts.filter((a) => wanted.has(artifactValue(a)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils/registry-view.ts cli/tests/utils/registry-view.test.ts
git commit -m "feat(registry-view): add drill-down option builders and resolver"
```

---

## Task 5: Wire `awm list` to the new model

**Files:**
- Modify: `cli/src/index.ts` (the `list` command, currently lines 258-346; and its option/arg signature)

- [ ] **Step 1: Add the `[package]` arg and `--all` option, and rewrite the action**

Replace the entire `program.command('list')...` block (`index.ts:258-346`) with:

```ts
program.command('list [package]')
  .description('List available artifacts. With no argument shows a package summary; pass a package name or --all for detail.')
  .option('-a, --all', 'Expand every package')
  .action(async (packageName: string | undefined, options: { all?: boolean }) => {
      intro(pc.bgCyan(pc.black(' AWM - Registry Listing ')));

      const s = spinner();
      s.start('Syncing registry...');
      try {
          await syncRegistry();
          s.stop('Registry synced.');
      } catch (e: any) {
          s.stop('Failed to sync registry.');
          console.error(pc.red(e.message));
          process.exit(1);
      }

      const view = buildPackageView(discoverSkills(), discoverWorkflows(), discoverAgents(), discoverProcesses());

      if (view.length === 0) {
          outro(pc.yellow('No artifacts found in the registry. Run `awm update` or check your registry content.'));
          return;
      }

      // Detail for a single package.
      if (packageName) {
          const { match, suggestion } = findPackage(view, packageName);
          if (!match) {
              console.error(pc.red(`No package named "${packageName}".`) + (suggestion ? pc.dim(` Did you mean "${suggestion}"?`) : ''));
              process.exit(1);
          }
          console.log();
          for (const line of packageDetailLines(match)) console.log(line);
          console.log();
          outro(`Run ${pc.green(`awm add`)} to install artifacts from ${pc.cyan(match.name)}.`);
          return;
      }

      // Expand everything.
      if (options.all) {
          for (const pkg of view) {
              console.log();
              for (const line of packageDetailLines(pkg)) console.log(line);
          }
          console.log();
          outro(`Run ${pc.green('awm add')} to install any of these artifacts.`);
          return;
      }

      // Default: compact summary.
      console.log();
      for (const line of packageSummaryLines(view)) console.log(line);
      console.log();
      console.log(pc.dim(`  awm list <package>  ·  awm list --all`));
      outro(`Run ${pc.green('awm add')} to install artifacts.`);
  });
```

- [ ] **Step 2: Update imports**

In `cli/src/index.ts`, add the registry-view import (near line 6):

```ts
import { buildPackageView, packageSummaryLines, packageDetailLines, findPackage } from './utils/registry-view';
```

(Leave the `grouping` import for now — it is still used by `add`; it is removed in Task 7.)

- [ ] **Step 3: Build and smoke-test**

Run: `cd cli && npm run build`
Expected: compiles with no TypeScript errors.

Run: `cd cli && node dist/src/index.js list`
Expected: a compact summary — header `AWM Registry — N packages, M skills`, one aligned line per package, the `awm list <package>` hint, and the outro.

Run: `cd cli && node dist/src/index.js list core-dev`
Expected: `core-dev` header with its skills and descriptions.

Run: `cd cli && node dist/src/index.js list --all`
Expected: every package expanded.

Run: `cd cli && node dist/src/index.js list nope`
Expected: red `No package named "nope".` with a suggestion, exit code 1.

- [ ] **Step 4: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(list): compact summary with on-demand package detail"
```

---

## Task 6: Wire `awm add` to the drill-down

**Files:**
- Modify: `cli/src/index.ts` (the artifact build + selection steps inside `add`, currently lines 127-163)

- [ ] **Step 1: Replace the artifact list-building and selection (steps 4 & 5 of `add`)**

In the `add` action, replace the block that builds `allAvailable` / `groupedOpts` and runs the single multiselect (`index.ts:127-163`, from the `// 4. Build unified artifact list grouped by process` comment through the `resolved`/`artifactsToInstall` assignment) with:

```ts
      // 4. Build the package view, filtered to artifact types the target agent(s) support
      const includeWorkflows = targetAgents.some(a => PROVIDERS[a].workflow !== null);
      const includeAgents = targetAgents.some(a => PROVIDERS[a].agent !== null);
      const view = buildPackageView(
          skills,
          includeWorkflows ? workflows : [],
          includeAgents ? agents : [],
          processes
      );

      if (view.length === 0) {
          outro(pc.yellow('No artifacts available for the selected agent(s).'));
          process.exit(0);
      }

      // 5. Level 1 — pick package(s)
      const pkgChoice = await multiselect({
          message: 'Select package(s)',
          options: buildLevel1Options(view),
          required: true
      });
      handleCancel(pkgChoice);
      const selectedPackages = (pkgChoice as string[])
          .map(name => view.find(p => p.name === name)!)
          .filter(Boolean);

      // 5b. Level 2 — pick skills within each package, in sequence
      const dedup = new Map<string, ArtifactView>();
      for (let i = 0; i < selectedPackages.length; i++) {
          const pkg = selectedPackages[i];
          const skillChoice = await multiselect({
              message: `[${i + 1}/${selectedPackages.length}] ${pkg.name} — select skills`,
              options: buildLevel2Options(pkg),
              initialValues: [ALL_SENTINEL],
              required: true
          });
          handleCancel(skillChoice);
          for (const a of resolveLevel2Selection(pkg, skillChoice as string[])) {
              dedup.set(`${a.type}:${a.installName}`, a);
          }
      }

      const artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] =
          Array.from(dedup.values()).map(a => ({ name: a.installName, sourcePath: a.sourcePath, type: a.type }));

      if (artifactsToInstall.length === 0) {
          outro(pc.yellow('No artifacts selected.'));
          return;
      }
```

The downstream install logic (method prompt, confirm, install loop, outro) is unchanged — it already consumes `artifactsToInstall` with `{ name, sourcePath, type }`.

- [ ] **Step 2: Update imports**

Extend the registry-view import added in Task 5 to include the add helpers, and add the `ArtifactView` type import:

```ts
import { buildPackageView, packageSummaryLines, packageDetailLines, findPackage, buildLevel1Options, buildLevel2Options, resolveLevel2Selection, ALL_SENTINEL, ArtifactView } from './utils/registry-view';
```

- [ ] **Step 3: Build**

Run: `cd cli && npm run build`
Expected: compiles with no TypeScript errors. (If `CombinedArtifact`/`GroupableArtifact`/`buildGroupedOptions`/`resolveSelectedArtifacts` are now unused, leave them — Task 7 removes them.)

- [ ] **Step 4: Manual smoke test of the interactive flow**

Run: `cd cli && node dist/src/index.js add`
Walk through: pick agent(s) → scope → **Level 1** shows `📦`/`🔹` packages with dimmed counts → select `core-dev` and one more → **Level 2** opens once per package with `✨ Install entire package` preselected and each skill showing its description on a dimmed second line → confirm → install.
Verify: leaving the sentinel checked installs all; unchecking it and picking 2 skills installs exactly those; selecting two packages iterates `[1/2]`, `[2/2]`.

> If `@clack` renders the two-line label with a misaligned continuation line that you find unacceptable, the fallback is to collapse the description into the same line inside the label (e.g. `${head}  ${pc.dim('— ' + a.description)}`) in `buildLevel2Options`. Do NOT move it to `hint` (hints only render on the focused row). Re-run `npx jest tests/utils/registry-view.test.ts` after any label change.

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(add): two-level package drill-down selection"
```

---

## Task 7: Remove the old grouping module

**Files:**
- Delete: `cli/src/utils/grouping.ts`, `cli/tests/utils/grouping.test.ts`
- Modify: `cli/src/index.ts` (drop the `grouping` import and the now-unused `resolveSelectedArtifacts`/`handleCancel`-adjacent helpers if orphaned)

- [ ] **Step 1: Confirm `grouping` is no longer referenced**

Run: `cd /Users/cencosud/Developments/personal/agentic-workflow && grep -rn "grouping\|buildGroupedOptions\|GroupableArtifact\|CombinedArtifact\|resolveSelectedArtifacts" cli/src`
Expected: the only hits are the import line and the `resolveSelectedArtifacts` definition in `cli/src/index.ts` (both removed next). No other usage.

- [ ] **Step 2: Delete the module, its test, and dead code**

```bash
cd /Users/cencosud/Developments/personal/agentic-workflow
git rm cli/src/utils/grouping.ts cli/tests/utils/grouping.test.ts
```

In `cli/src/index.ts`:
- Remove the import line `import { buildGroupedOptions, GroupableArtifact, CombinedArtifact } from './utils/grouping';`
- Remove the now-unused `resolveSelectedArtifacts` function (`index.ts:30-44`).

- [ ] **Step 3: Build to prove nothing else depended on it**

Run: `cd cli && npm run build`
Expected: compiles cleanly. If the compiler flags an unused import (e.g. `SKILLS_DIR`/`WORKFLOWS_DIR`/`AGENTS_DIR` if they became unused), remove only the genuinely-unused names it reports.

- [ ] **Step 4: Run the full test suite**

Run: `cd cli && npm test`
Expected: all suites pass; no reference to the deleted `grouping.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove flat grouping module superseded by registry-view"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build + full test run**

Run: `cd cli && npm run build && npm test`
Expected: build succeeds; every Jest suite passes.

- [ ] **Step 2: End-to-end manual pass**

Run each and confirm against the design (`docs/plans/2026-06-01-awm-list-add-ux-design.md`):
- `node dist/src/index.js list` → compact summary.
- `node dist/src/index.js list docs` → docs package detail with descriptions.
- `node dist/src/index.js list --all` → all packages expanded.
- `node dist/src/index.js add` → 2-level drill-down, per-package iteration, "install entire package" default, descriptions visible.

- [ ] **Step 3: Confirm no stray references**

Run: `cd /Users/cencosud/Developments/personal/agentic-workflow && grep -rn "grouping" cli/src cli/tests`
Expected: no matches.

---

## Self-review notes (coverage map)

- Shared model `registry-view.ts` → Task 2.
- Frontmatter descriptions → Task 1.
- `add` drill-down (level 1 packages, level 2 per-package with "install entire package" default, multi-package iteration, dedup) → Tasks 4 & 6.
- `list` summary / `<pkg>` / `--all` + closest-name suggestion → Tasks 3 & 5.
- Edge cases: empty registry (Tasks 5, 6), unknown package + suggestion (Tasks 3, 5), missing description shows name only (Tasks 1, 3, 4), workflows/agents in a package carry their icon and are covered by "install entire package" (Tasks 2, 4).
- Testing: `registry-view.test.ts` + `discovery.test.ts` additions; `grouping.test.ts` removed (Task 7).
- Out of scope honored: no new deps, no `remove` changes, no UI screens.
