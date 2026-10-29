// Local `.git` commit for hand-seeded registry content roots used by real
// (unstubbed) `awm init` / `stepCache` paths.
//
// Under SG-7 (#238), any sync/clone error hard-fails init. Diagnostics treat
// `registryCache.present` as "`.git` exists" (`context.ts`), so a content-only
// fixture always triggers sync against the unreachable `example.invalid`
// remote. Committing locally makes cache present and lets stepCache skip.
import { execFileSync } from 'child_process';

export function commitSeededRegistry(root: string): void {
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root, stdio: 'ignore' });
}
