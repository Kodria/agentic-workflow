import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerJobCommand } from '../../../src/commands/job';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { reserveRoutingAttempt, observeRoutingAttempt } from '../../../src/core/model-policy/journal';

const envelope = { schema: 'routing-envelope/v1' as const, runtime: { target: 'codex', kind: 'native', version: '1', accountScopeDigest: '0'.repeat(64) }, role: 'implementer', sliceId: 'S1', requestedProfile: 'mechanical' as const, effectiveProfile: 'mechanical' as const, resolved: { selector: { kind: 'model' as const, id: 'model-private' }, effort: { kind: 'explicit' as const, value: 'medium' } }, outcome: 'native' as const, unavailableEvidence: [], policyDigest: 'a'.repeat(64), capabilityDigest: 'b'.repeat(64), planDigest: 'c'.repeat(64), executionDigest: 'd'.repeat(64) };

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'init', '-q', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'fixture'), 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: repo });
}

test('`job routing-report --json` emits only aggregate routing evidence', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-routing-report-'));
    try {
        gitInit(repo); initJournal(repo, 'main');
        const state = readJournal(repo, 'main').state!;
        const reserved = reserveRoutingAttempt(state, { obligationId: 'obligation', lineageId: 'lineage', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z');
        writeJournal(repo, 'main', observeRoutingAttempt(reserved.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-private' }, '2026-09-17T00:01:00.000Z'));
        const program = new Command(); program.exitOverride(); registerJobCommand(program);
        const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const cwd = jest.spyOn(process, 'cwd').mockReturnValue(repo);
        await program.parseAsync(['node', 'awm', 'job', 'routing-report', '--json']);
        const rendered = String(out.mock.calls[0][0]); const report = JSON.parse(rendered);
        expect(report).toMatchObject({ schema: 'routing-report/v1', attempts: 1, plannedByRole: { implementer: 1 }, actualByRole: { implementer: 1 }, byState: { active: 1 } });
        expect(rendered).not.toContain('native-private'); expect(rendered).not.toContain('model-private');
        cwd.mockRestore(); out.mockRestore();
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
