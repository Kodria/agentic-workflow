import { collectDashboardSnapshot, productionDashboardAdapters } from '../../../src/core/dashboard/collect';
import type { HarnessContext } from '../../../src/core/diagnostics/types';
import { writeCycleEvidence } from '../../../src/core/evidence/store';
import { initJournal, writeJournal } from '../../../src/core/journal/store';
import { emptyState } from '../../../src/core/journal/types';
import { cycleEvidenceFixture } from '../../helpers/evidence-fixtures';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PROCESS_MODEL_FIXTURE = `---
awm: process-model
schema: 1
name: NAME
status: STATUS
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

## Objetivo

G — Objetivo.

## Cuándo aplica

Siempre.

## Estructura

- SG-1 — Uno
  - OP-1.1 — Hacer

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| Al empezar | | OP-1.1 | SG-1 |

## Terminación

none

## Sin verificar

- Nada.
`;

function context(): HarnessContext {
    return {
        machine: {} as HarnessContext['machine'],
        project: {
            root: '/private/project',
            profile: { present: true, extensions: ['delivery'], registries: { base: '1.2.3' } },
            activeBundles: { expected: ['delivery'], linked: ['delivery'], broken: [] },
            orphanLinks: { repairable: [], dead: [], usurped: [] },
            sensors: { present: true }, constitution: { present: true }, context: { present: true, file: 'AGENTS.md' },
        },
        providers: [{
            id: 'codex', label: 'Codex', tier: 'hooks-native', checks: [
                { id: 'binary.version', state: 'supported', target: '0.145.0' },
                { id: 'hook.trust', state: 'pending-trust', remediationCode: 'awm hooks trust --agent codex' },
            ],
        }],
    };
}

describe('productionDashboardAdapters', () => {
    it('maps existing diagnostics into canonical, share-safe machine and project facts', () => {
        const adapters = productionDashboardAdapters(context());
        const machine = adapters.machine({ cwd: '/private/project' });
        const project = adapters.project({ root: '/private/project' });

        expect(machine.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'machine.provider.codex.binary.version', state: 'ok' }),
            expect.objectContaining({ id: 'machine.provider.codex.hook.trust', state: 'attention' }),
        ]));
        expect(project.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'project.profile.present', state: 'ok' }),
            expect.objectContaining({ id: 'project.extensions.configured', state: 'ok' }),
            expect.objectContaining({ id: 'project.registry-pins.present', state: 'ok' }),
            expect.objectContaining({ id: 'project.context.present', state: 'ok' }),
            expect.objectContaining({ id: 'project.constitution.present', state: 'ok' }),
            expect.objectContaining({ id: 'project.sensors.present', state: 'ok' }),
        ]));
        expect(JSON.stringify({ machine, project })).not.toMatch(/private|0\.145\.0|hooks trust/i);
    });

    it('reports only source-verified remediation and leaves unavailable lifecycle sources explicit', () => {
        const adapters = productionDashboardAdapters({ ...context(), project: null });
        expect(adapters.machine({ cwd: '/tmp' }).findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'machine.provider.codex.hook.trust', remediationVerified: false }),
        ]));
        expect(adapters.execution({ root: '/tmp' })).toBeUndefined();
    });

    it('contains no diagnostic prose or raw source details', () => {
        const facts = context();
        facts.providers![0].checks[1].detail = 'token=secret /private/path <script>';
        const serialized = JSON.stringify(productionDashboardAdapters(facts).machine({ cwd: '/private/project' }));
        expect(serialized).not.toMatch(/token|secret|private|script/i);
    });

    it('retains stable provider ids after collection and maps a verified bundle remedy', () => {
        const facts = context();
        facts.project!.activeBundles.broken = ['delivery'];
        const snapshot = collectDashboardSnapshot({
            cwd: process.cwd(), now: '2026-08-22T00:00:00.000Z', adapters: productionDashboardAdapters(facts),
        });
        const machine = snapshot.sections.find((section) => section.id === 'machine')!;
        const project = snapshot.sections.find((section) => section.id === 'project')!;
        expect(machine.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'machine.provider.codex.binary.version', state: 'ok' }),
        ]));
        expect(project.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'project.bundles.coherent', remediation: 'awm sync' }),
        ]));
        expect(JSON.stringify(snapshot)).not.toMatch(/remediationVerified|private|0\.145\.0|token/i);
    });

    it('derives plan lifecycle and execution evidence from validated local cycle records', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-dashboard-production-evidence-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        writeCycleEvidence(root, {
            ...cycleEvidenceFixture(),
            plan: { ref: 'docs/plans/current.md', state: 'executed' },
            tasks: [{ id: 'task-1', attempts: 2, retries: 1 }],
            qa: { findings: 1, fixes: 1, signatures: ['a'.repeat(64)] },
        });

        const snapshot = collectDashboardSnapshot({
            cwd: root, now: '2026-08-22T00:00:00.000Z', adapters: productionDashboardAdapters(context()),
        });

        expect(snapshot.sections.find((section) => section.id === 'planning')?.items).toEqual([
            expect.objectContaining({ detail: 'executed', state: 'ok' }),
        ]);
        expect(snapshot.sections.find((section) => section.id === 'execution')?.items).toEqual([
            expect.objectContaining({ state: 'ok' }),
        ]);
        expect(snapshot.sections.find((section) => section.id === 'qa')?.items).toEqual([
            expect.objectContaining({ state: 'ok' }),
        ]);
        expect(snapshot.sections.find((section) => section.id === 'docs')?.items).toEqual([
            expect.objectContaining({ state: 'ok' }),
        ]);
        expect(snapshot.sections.find((section) => section.id === 'retro')?.items).toEqual([
            expect.objectContaining({ state: 'ok' }),
        ]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('flags the docs section as attention when a captured cycle has not documented yet', () => {  // verifies R6.3
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-dashboard-docs-attention-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        writeCycleEvidence(root, {
            ...cycleEvidenceFixture(),
            plan: { ref: 'docs/plans/current.md', state: 'qa_pending' },
        });

        const snapshot = collectDashboardSnapshot({
            cwd: root, now: '2026-08-22T00:00:00.000Z', adapters: productionDashboardAdapters(context()),
        });

        expect(snapshot.sections.find((section) => section.id === 'docs')?.items).toEqual([
            expect.objectContaining({ state: 'attention' }),
        ]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it.each([
        ['IN_PROGRESS', 'active', 'ok'],
        ['BLOCKED', 'blocked', 'attention'],
    ] as const)('overlays the current branch journal %s over prior executed evidence', (status, expectedLifecycle, expectedState) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-dashboard-journal-overlay-'));
        const branch = 'dashboard-overlay';
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        execFileSync('git', ['init', '--initial-branch', branch], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'dashboard@example.test'], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.name', 'Dashboard Test'], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
        writeCycleEvidence(root, { ...cycleEvidenceFixture(), plan: { ref: 'docs/plans/current.md', state: 'executed' } });
        initJournal(root, branch);
        const journal = emptyState(branch);
        journal.cycle.status = status;
        writeJournal(root, branch, journal);

        const snapshot = collectDashboardSnapshot({
            cwd: root, now: '2026-08-22T00:00:00.000Z', adapters: productionDashboardAdapters(context()),
        });

        expect(snapshot.sections.find((section) => section.id === 'planning')?.items).toEqual([
            expect.objectContaining({ detail: expectedLifecycle, state: expectedState }),
        ]);
        expect(JSON.stringify(snapshot)).not.toMatch(/dashboard-overlay|dashboard@example|Dashboard Test/i);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it.each([
        ['IN_PROGRESS', 'active', 'ok'],
        ['BLOCKED', 'blocked', 'attention'],
    ] as const)('renders the current branch journal %s without prior evidence', (status, expectedLifecycle, expectedState) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-dashboard-journal-only-'));
        const branch = 'dashboard-journal-only';
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        execFileSync('git', ['init', '--initial-branch', branch], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'dashboard@example.test'], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.name', 'Dashboard Test'], { cwd: root, stdio: 'ignore' });
        execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
        initJournal(root, branch);
        const journal = emptyState(branch);
        journal.cycle.status = status;
        writeJournal(root, branch, journal);

        const snapshot = collectDashboardSnapshot({
            cwd: root, now: '2026-08-22T00:00:00.000Z', adapters: productionDashboardAdapters(context()),
        });

        expect(snapshot.sections.find((section) => section.id === 'planning')?.items).toEqual([
            expect.objectContaining({ detail: expectedLifecycle, state: expectedState }),
        ]);
        expect(snapshot.sections.find((section) => section.id === 'execution')).toEqual(expect.objectContaining({
            availability: 'available', items: [expect.objectContaining({ state: expectedState })],
        }));
        expect(JSON.stringify(snapshot)).not.toMatch(/dashboard-journal-only|dashboard@example|Dashboard Test/i);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('processes delegates to discoverProcessModels() and maps its models to {name, status}', () => {
        const awmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-dashboard-processes-home-'));
        const originalAwmHome = process.env.AWM_HOME;
        process.env.AWM_HOME = awmHome;
        try {
            fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
            const skillDir = path.join(awmHome, 'registries', 'baseline', 'skills', 'mi-proceso');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), PROCESS_MODEL_FIXTURE.replace('NAME', 'mi-proceso').replace('STATUS', 'active'));

            const adapters = productionDashboardAdapters(context());
            expect(adapters.processes({ root: '/private/project' })).toEqual([{ name: 'mi-proceso', status: 'active' }]);
        } finally {
            if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
            fs.rmSync(awmHome, { recursive: true, force: true });
        }
    });
});
