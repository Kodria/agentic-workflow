import { attachRoutingSetupGuidance } from '../../src/commands/doctor';
import type { ProviderDiagnosticReport } from '../../src/core/diagnostics/types';

describe('doctor routing setup', () => {
    it('adds a pending, non-degrading machine configuration action only to the mapped provider', () => {
        const report: ProviderDiagnosticReport = {
            overall: 'healthy', providers: [
                { id: 'codex', label: 'Codex', tier: 'hooks-native', checks: [] },
                { id: 'claude-code', label: 'Claude Code', tier: 'hooks-native', checks: [] },
            ],
        };
        const updated = attachRoutingSetupGuidance(report, [
            { target: 'codex', runtimeKind: 'native', state: 'needs-evidence', command: 'awm model-policy discover --provider codex --json' },
        ]);
        expect(updated.providers[0].checks).toEqual([
            { id: 'routing.machine', state: 'pending', detail: 'native routing evidence not checked for native', remediationCode: 'awm model-policy discover --provider codex --json' },
        ]);
        expect(updated.providers[1].checks).toEqual([]);
        expect(updated.overall).toBe('healthy');
        expect(report.providers[0].checks).toEqual([]);
    });
});
