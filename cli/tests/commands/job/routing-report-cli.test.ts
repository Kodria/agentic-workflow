import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { registerJobCommand } from '../../../src/commands/job';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { reserveRoutingAttempt, observeRoutingAttempt } from '../../../src/core/model-policy/journal';
import { capabilityReceiptDigest } from '../../../src/core/model-policy/capabilities';
import { routingApproval, routingEnvelope } from '../../helpers/routing-approval';

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'init', '-q', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'fixture'), 'x');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: repo });
}

test('`job routing-report --json` exposes selections but not native child identities or envelopes', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-routing-report-'));
    try {
        gitInit(repo); initJournal(repo, 'main');
        const state = readJournal(repo, 'main').state!;
        const approved = routingApproval();
        const privateSelection = { ...routingEnvelope.resolved, selector: { kind: 'model' as const, id: 'model-private' } };
        approved.policy.content.mappings[0].profiles.mechanical = privateSelection;
        approved.capabilities.availableSelections.push(privateSelection);
        const envelope = { ...routingEnvelope, resolved: privateSelection, capabilityDigest: capabilityReceiptDigest(approved.capabilities) };
        const reserved = reserveRoutingAttempt(state, { obligationId: 'obligation', lineageId: 'lineage', envelope, fingerprint: 'e'.repeat(64), approval: () => approved }, '2026-09-17T00:00:00.000Z');
        writeJournal(repo, 'main', observeRoutingAttempt(reserved.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-private' }, '2026-09-17T00:01:00.000Z'));
        const program = new Command(); program.exitOverride(); registerJobCommand(program);
        const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const cwd = jest.spyOn(process, 'cwd').mockReturnValue(repo);
        await program.parseAsync(['node', 'awm', 'job', 'routing-report', '--json']);
        const rendered = String(out.mock.calls[0][0]); const report = JSON.parse(rendered);
        expect(report).toMatchObject({ schema: 'routing-report/v1', attempts: 1, plannedByRole: { implementer: 1 }, actualByRole: { implementer: 1 }, byState: { active: 1 },
            selections: [{ configured: privateSelection, accepted: 'unknown', backendModel: 'unknown' }] });
        expect(rendered).not.toContain('native-private'); expect(rendered).not.toContain('obligation');
        cwd.mockRestore(); out.mockRestore();
    } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
