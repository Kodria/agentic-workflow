// `stepContextInjection` is a MACHINE-level step — it runs even when `ctx.project`
// is null. For providers whose context delivery is project-scope (managed-agents-md
// with `globalPath: null` — Cursor, Copilot) it then fell back to writing at `d.cwd`:
//
//     $ cd ~/scratch && awm init -a copilot     # not a project: no .git, no package.json
//     ~/scratch/AGENTS.md                       ← written
//     ~/scratch/.awm/context/awm-context.md     ← written
//
// `planInitMutationTargets` enumerates both of those paths only inside
// `if (projectRoot)`, so with no project root neither entered the backup session. A
// later failed step rolled back everything that WAS enumerated and left these two
// behind — while the outcome reported `rolledBack: true` and listed `restoredFiles`,
// i.e. claimed a clean restore it had not performed.
//
// `--machine-only` reached the same place from the other side: it nulls `ctx.project`
// deliberately, so the step took the `?? d.cwd` branch even inside a real project.
//
// Two different situations were being read as one. Running in a directory the user
// means as their project but which has no marker yet is legitimate — Copilot has no
// other channel, so removing that write would leave it with no context at all. What
// was wrong is that the path was never enumerated, so it survived rollback; that is
// fixed in mutation-targets, which now covers `cwd` for these providers regardless of
// whether a project root was found.
//
// `--machine-only` is the case that must not write at all: it nulls `ctx.project` on
// purpose, and this step read that as "no project found" and wrote into cwd anyway —
// under the one flag whose entire promise is that it won't touch the project.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { stepContextInjection } from '../../../src/core/init/steps';
import { planInitMutationTargets } from '../../../src/core/init/mutation-targets';
import { projectContextPath } from '../../../src/core/context/materializer';
import type { InitDeps } from '../../../src/core/init/types';
import type { AgentTarget } from '../../../src/providers';
import { mkCanonicalTmpDir } from '../../support/tmp';

function deps(
    agent: AgentTarget,
    cwd: string,
    projectRoot: string | null,
    machineOnly = false,
): { d: InitDeps; installed: unknown[] } {
    const installed: unknown[] = [];
    const d = {
        cwd,
        agent,
        enabledAgents: [agent],
        bundles: [],
        installMethod: 'symlink',
        registryRoot: '',
        contentDir: '',
        sensorPacksRoot: '',
        machineOnly,
        ctx: {
            machine: {},
            project: projectRoot ? { root: projectRoot } : null,
        },
        actions: {
            contextStatus: () => 'absent',
            installContext: (op: unknown) => { installed.push(op); },
        },
    } as unknown as InitDeps;
    return { d, installed };
}

describe('project-scope context injection without a project', () => {
    let cwd: string;

    beforeEach(() => { cwd = mkCanonicalTmpDir('awm-noproj-'); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    it.each(['copilot', 'cursor'] as const)(
        '%s: writes nothing at all under --machine-only',
        (agent) => {
            const { d, installed } = deps(agent, cwd, null, true);

            const result = stepContextInjection(d);

            expect(installed).toEqual([]);
            expect(result.action).toBe('skipped');
            expect(result.detail).toMatch(/machine-only/i);
        },
    );

    it.each(['copilot', 'cursor'] as const)(
        '%s: still delivers into an unmarked cwd — its only channel — now that the path is backed up',
        (agent) => {
            const { d, installed } = deps(agent, cwd, null);

            const result = stepContextInjection(d);

            expect(result.action).toBe('applied');
            expect((installed[0] as { projectRoot: string }).projectRoot).toBe(cwd);
            // the write is only safe because mutation-targets enumerates it — asserted below
            expect(planInitMutationTargets({ cwd, agent, bundles: [] }))
                .toContain(path.join(cwd, 'AGENTS.md'));
        },
    );

    it('leaves a GLOBAL-scope provider untouched by --machine-only', () => {
        // --machine-only excludes the project, not the machine. Codex's context is
        // machine-global, so it must still be installed.
        const { d, installed } = deps('codex', cwd, null, true);

        expect(stepContextInjection(d).action).toBe('applied');
        expect(installed).toHaveLength(1);
    });

    it('still injects for a local-scope provider when a project root IS known', () => {
        const { d, installed } = deps('copilot', cwd, cwd);

        const result = stepContextInjection(d);

        expect(result.action).toBe('applied');
        expect(installed).toHaveLength(1);
        expect((installed[0] as { projectRoot: string }).projectRoot).toBe(cwd);
    });

    it('leaves global-scope injection (codex) alone — it needs no project', () => {
        const { d, installed } = deps('codex', cwd, null);

        const result = stepContextInjection(d);

        expect(result.action).toBe('applied');
        expect(installed).toHaveLength(1);
        expect((installed[0] as { scope: string }).scope).toBe('global');
    });
});

describe('mutation-targets covers the local-scope context paths independently', () => {
    let cwd: string;

    beforeEach(() => { cwd = mkCanonicalTmpDir('awm-noproj-mt-'); });
    afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

    it.each(['copilot', 'cursor'] as const)(
        '%s: enumerates AGENTS.md and .awm/context even with no project root',
        (agent) => {
            const targets = planInitMutationTargets({ cwd, agent, bundles: [] });

            expect(targets).toContain(path.join(cwd, 'AGENTS.md'));
            expect(targets).toContain(projectContextPath(cwd));
        },
    );

    it('does not invent those targets for a provider that never writes them', () => {
        const targets = planInitMutationTargets({ cwd, agent: 'claude-code', bundles: [] });

        expect(targets).not.toContain(projectContextPath(cwd));
    });
});
