import { admitPlan, sanitizeAdmissionReport } from '../../../src/core/admission';
import type { PlanValidationReport } from '../../../src/core/plan/types';
import { emptyState } from '../../../src/core/journal/types';

const valid: Extract<PlanValidationReport, { state: 'valid' }> = {
    state: 'valid', schema: 'compact-slices/v1', planDigest: 'a'.repeat(64),
    manifest: {
        schema: 'compact-slices/v1', planId: 'admission-fixture', requirements: ['RF-2.2'],
        sources: [], commands: [], closureCommands: [],
        slices: [{ id: 'S1', title: 'one', requirements: ['RF-2.2'], dependsOn: [], sectionAnchor: 's1', sources: [], redCommands: [], greenCommands: [], reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: [] }],
    },
};

describe('admitPlan', () => {
    it('rejects a forecast whose total or role topology does not match its slices', () => {
        const forecast = { kind: 'topology', slices: 2, roles: { implementer: 2, 'specification-reviewer': 2, 'code-quality-reviewer': 2, 'final-reviewer': 1, 'track-a-qa': 1, 'track-b-qa': 1, documentation: 1, retro: 1, finishing: 1 }, total: 99 };
        expect(() => sanitizeAdmissionReport({ state: 'admitted', planState: 'valid', journal: 'not-required', currentness: 'not-checked', sensors: 'not-required', diagnostics: [], forecast })).toThrow(/invalid report/);
        forecast.total = 12;
        forecast.roles.implementer = 1;
        expect(() => sanitizeAdmissionReport({ state: 'admitted', planState: 'valid', journal: 'not-required', currentness: 'not-checked', sensors: 'not-required', diagnostics: [], forecast })).toThrow(/invalid report/);
    });
    it('preserves the distinct unsupported plan state and bounded validator diagnostic', async () => {
        const report = await admitPlan({ plan: { state: 'unsupported', schema: 'compact-slices/v9', diagnostics: [{ code: 'PLAN_UNSUPPORTED_SCHEMA', message: `future\u001b${'x'.repeat(5000)}` }] }, provider: 'codex', cwd: process.cwd() });
        expect(report).toMatchObject({ state: 'blocked', planState: 'unsupported', currentness: 'not-checked', sensors: 'not-required' });
        expect(report.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['ADMISSION_PLAN_UNSUPPORTED', 'PLAN_UNSUPPORTED_SCHEMA']);
        expect(report.diagnostics[1].message).toHaveLength(4096);
        expect(report.diagnostics[1].message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    });

    it('does not block a private registry only when declared plan provenance proves it unconsumed', async () => {
        const report = await admitPlan({
            plan: valid, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'], requireCurrent: true,
            currentness: { checkedAt: '2026-01-01T00:00:00.000Z', compatibility: { status: 'not-checked' }, components: [
                { component: 'cli', installed: '1.0.0', latest: '1.0.0', channel: 'stable', source: 'npm', checkedAt: '2026-01-01T00:00:00.000Z', status: 'current', detail: 'ok', remedy: 'none' },
                { component: 'registry:private', installed: null, latest: null, channel: 'stable', source: 'private', checkedAt: '2026-01-01T00:00:00.000Z', status: 'unverifiable', detail: 'no', remedy: 'none' },
            ] },
            consumedRegistryComponents: [], provenance: 'proven',
        } as any);
        expect(report).toMatchObject({ state: 'admitted', currentness: 'current', sensors: 'not-required' });
    });

    it('blocks currentness when registry-contract provenance is not sufficient to prove irrelevance', async () => {
        const report = await admitPlan({ plan: valid, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'], requireCurrent: true, currentness: { checkedAt: 'x', compatibility: { status: 'not-checked' }, components: [] } } as any);
        expect(report).toMatchObject({ state: 'blocked', currentness: 'unverifiable', sensors: 'not-required' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_CURRENTNESS_PROVENANCE_REQUIRED');
    });
    it('blocks when a proven consumed registry has no currentness component', async () => {
        const report = await admitPlan({ plan: valid, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'], requireCurrent: true, provenance: 'proven', consumedRegistryComponents: ['registry:private'], currentness: { checkedAt: 'x', compatibility: { status: 'not-checked' }, components: [{ component: 'cli', installed: '1.0.0', latest: '1.0.0', channel: 'stable', source: 'npm', checkedAt: 'x', status: 'current', detail: 'ok', remedy: 'none' }] } });
        expect(report).toMatchObject({ state: 'blocked', currentness: 'unverifiable' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_CURRENTNESS_MISSING_COMPONENT');
    });
    it('blocks a bogus execution mode instead of treating it as interactive', async () => {
        const report = await admitPlan({ plan: valid, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'], executionMode: 'background' as any });
        expect(report).toMatchObject({ state: 'blocked', executionMode: 'interactivo' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_EXECUTION_MODE_INVALID');
    });
    it('stops at an unmarked plan before checking any later boundary', async () => {
        const report = await admitPlan({ plan: { state: 'migration-required', reason: 'unmarked-plan' }, provider: 'codex', cwd: process.cwd() });
        expect(report).toMatchObject({ state: 'blocked', planState: 'migration-required', journal: 'not-required' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_PLAN_MIGRATION_REQUIRED');
        expect(report.currentness).toBe('not-checked');
        expect(report.sensors).toBe('not-required');
    });

    it('blocks a disabled provider before remote currentness or sensors', async () => {
        const report = await admitPlan({ plan: valid, provider: 'codex', cwd: process.cwd(), enabledAgents: ['claude-code'] });
        expect(report).toMatchObject({ state: 'blocked', planDigest: valid.planDigest, provider: 'codex' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_PROVIDER_DISABLED');
        expect(report.currentness).toBe('not-checked');
    });

    it('does not let an unverified execution capability admit interactive work', async () => {
        const report = await admitPlan({ plan: valid, provider: 'cursor', cwd: process.cwd(), enabledAgents: ['cursor'] });
        expect(report).toMatchObject({ state: 'blocked', executionMode: 'interactivo', provider: 'cursor', journal: 'not-required' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_CAPABILITY_UNVERIFIED');
    });

    it('reports the schema-2 journal prerequisite for otherwise admissible unattended work', async () => {
        const unattended = { ...valid, manifest: { ...valid.manifest, executionMode: 'desatendido' } } as PlanValidationReport;
        const report = await admitPlan({ plan: unattended, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'] });
        expect(report).toMatchObject({ state: 'blocked', executionMode: 'desatendido', journal: 'missing' });
        expect(report.diagnostics[0]).toMatchObject({ code: 'ADMISSION_JOURNAL_BINDING_REQUIRED' });
        expect(report.forecast).toBeUndefined();
    });

    it('admits unattended work only with an exact schema-2 plan binding', async () => {
        const unattended = { ...valid, manifest: { ...valid.manifest, executionMode: 'desatendido' } } as PlanValidationReport;
        const journal = { ...emptyState('main'), schema: 2 as const, planBinding: { path: 'docs/plan.md', digest: 'a'.repeat(64), schema: 'compact-slices/v1' as const, executionMode: 'desatendido' as const, boundAt: '2026-09-15T00:00:00.000Z' } };
        const admitted = await admitPlan({ plan: unattended, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'], journalState: journal, planPath: 'docs/plan.md' });
        expect(admitted).toMatchObject({ state: 'admitted', journal: 'current', executionMode: 'desatendido' });
        const stale = await admitPlan({ plan: unattended, provider: 'codex', cwd: process.cwd(), enabledAgents: ['codex'], journalState: { ...journal, planBinding: { ...journal.planBinding, digest: 'b'.repeat(64) } }, planPath: 'docs/plan.md' });
        expect(stale).toMatchObject({ state: 'blocked', journal: 'stale' });
    });
});
