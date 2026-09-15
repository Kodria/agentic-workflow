import { admitPlan } from '../../../src/core/admission';
import type { PlanValidationReport } from '../../../src/core/plan/types';

const valid: Extract<PlanValidationReport, { state: 'valid' }> = {
    state: 'valid', schema: 'compact-slices/v1', planDigest: 'a'.repeat(64),
    manifest: {
        schema: 'compact-slices/v1', planId: 'admission-fixture', requirements: ['RF-2.2'],
        sources: [], commands: [], closureCommands: [],
        slices: [{ id: 'S1', title: 'one', requirements: ['RF-2.2'], dependsOn: [], sectionAnchor: 's1', sources: [], redCommands: [], greenCommands: [], reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: [] }],
    },
};

describe('admitPlan', () => {
    it('stops at an unmarked plan before checking any later boundary', async () => {
        const report = await admitPlan({ plan: { state: 'migration-required', reason: 'unmarked-plan' }, provider: 'codex', cwd: process.cwd() });
        expect(report).toMatchObject({ state: 'blocked', planState: 'migration-required', journal: 'not-required' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_PLAN_MIGRATION_REQUIRED');
        expect(report.currentness).toBeUndefined();
        expect(report.sensors).toBeUndefined();
    });

    it('blocks a disabled provider before remote currentness or sensors', async () => {
        const report = await admitPlan({ plan: valid, provider: 'codex', cwd: process.cwd(), enabledAgents: ['claude-code'] });
        expect(report).toMatchObject({ state: 'blocked', planDigest: valid.planDigest, provider: 'codex' });
        expect(report.diagnostics[0].code).toBe('ADMISSION_PROVIDER_DISABLED');
        expect(report.currentness).toBeUndefined();
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
        expect(report.diagnostics[0]).toMatchObject({ code: 'ADMISSION_JOURNAL_SCHEMA_2_REQUIRED' });
        expect(report.forecast).toBeUndefined();
    });
});
