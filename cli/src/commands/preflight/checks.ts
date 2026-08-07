import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { computeSensorStatus, resolveOnPath } from '../sensors/status';
import { detectStack } from '../sensors/init';
import { SensorManifest } from '../sensors/types';

/**
 * Preflight: can this project be gated at all?
 *
 * Every quality phase downstream consumes `awm sensors run` — the implementer, the
 * reviewers, post-qa. None of them verify the sensors can actually RUN. The capability
 * to check that already existed (`computeSensorStatus` resolves binaries, catches an
 * `npx` that would fetch a remote package, validates referenced config files); nothing
 * in the flow ever called it.
 *
 * The consequence is a discovery point at the worst possible moment. `awm sensors run`
 * exits 0 on `not_certified` by design (exit 2 is a blocking error in Claude Code
 * hooks), so the only thing standing between "no sensors configured" and "sensors
 * green" is each agent remembering to read `overall` out of the JSON instead of the
 * exit code. That is a prose defence over a mechanical problem, and prose does not hold.
 *
 * So this answers one question, mechanically, before any of that matters — and it is
 * deliberately agnostic to stack, language and tooling. It never asks "is eslint
 * configured"; it asks "can the sensors THIS repo declares actually run".
 */

export type PreflightCheck = {
    id: 'context' | 'manifest' | 'tools' | 'pack' | 'host';
    ok: boolean;
    detail: string;
    /** What the operator should do. Absent when `ok`. */
    remedy?: string;
};

export type PreflightReport = {
    /**
     * `ready`          — every check passed; safe to hand off to an unattended run.
     * `degraded`       — configured, but something it declares cannot run. The gate
     *                    would report on a harness that is partly decorative.
     * `not_configured` — no sensor manifest at all. Nothing was ever set up.
     *
     * `degraded` and `not_configured` are kept apart on purpose. One means "you set this
     * up and it broke"; the other means "you never set it up". Collapsing them is how an
     * absent check reads as a passing one.
     */
    status: 'ready' | 'degraded' | 'not_configured';
    checks: PreflightCheck[];
};

const MANIFEST = path.join('.awm', 'sensors.json');

/**
 * The agent needs project context delivered every session. A repo with neither file
 * hands every agent — and every teammate's agent — a blank slate.
 */
function checkContext(cwd: string): PreflightCheck {
    const present = ['AGENTS.md', 'CLAUDE.md', 'CONSTITUTION.md']
        .filter(f => fs.existsSync(path.join(cwd, f)));
    if (present.length === 0) {
        return {
            id: 'context',
            ok: false,
            detail: 'no AGENTS.md, CLAUDE.md or CONSTITUTION.md',
            remedy: 'run the project-context-init skill (AGENTS.md) or project-constitution (CONSTITUTION.md)',
        };
    }
    return { id: 'context', ok: true, detail: present.join(', ') };
}

function readManifest(cwd: string): SensorManifest | null {
    try {
        return JSON.parse(fs.readFileSync(path.join(cwd, MANIFEST), 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * A repo may legitimately have no sensors — but it has to SAY so, in a committed file.
 *
 * That is why opting out requires a manifest with its sensors disabled rather than
 * simply having no manifest. "We decided not to gate this repo" and "nobody ever ran
 * `awm sensors init`" look identical from the outside, and on a team the second one is
 * the common case. Requiring the manifest turns the decision into a reviewable diff.
 */
function checkManifest(cwd: string, manifest: SensorManifest | null): PreflightCheck {
    if (!fs.existsSync(path.join(cwd, MANIFEST))) {
        return {
            id: 'manifest',
            ok: false,
            detail: 'no .awm/sensors.json',
            remedy: 'run `awm sensors init` (to opt out deliberately, init and set every sensor '
                + '`"enabled": false` — an unconfigured repo and a deliberate opt-out must not look alike)',
        };
    }
    if (!manifest) {
        return {
            id: 'manifest',
            ok: false,
            detail: '.awm/sensors.json is not valid JSON',
            remedy: 'fix or regenerate it with `awm sensors init`',
        };
    }
    const total = Object.keys(manifest.sensors ?? {}).length;
    const enabled = Object.values(manifest.sensors ?? {}).filter(s => s.enabled !== false).length;
    return {
        id: 'manifest',
        ok: true,
        detail: enabled === 0 ? `pack ${manifest.pack}, all ${total} sensors disabled (deliberate opt-out)`
            : `pack ${manifest.pack}, ${enabled}/${total} sensors enabled`,
    };
}

/** Every enabled sensor's command must resolve. This is the check nothing was calling. */
function checkTools(cwd: string): PreflightCheck {
    const status = computeSensorStatus(cwd);
    if (status.overall === 'NOT_CONFIGURED') {
        return { id: 'tools', ok: false, detail: 'no manifest to check', remedy: 'run `awm sensors init`' };
    }
    const broken = Object.entries(status.checks).filter(([, c]) => !c.ok);
    if (broken.length > 0) {
        return {
            id: 'tools',
            ok: false,
            detail: broken.map(([name, c]) => `${name}: ${c.detail}`).join('; '),
            remedy: 'install the missing tools/configs, or disable those sensors deliberately',
        };
    }
    return { id: 'tools', ok: true, detail: `${Object.keys(status.checks).length} sensor(s) runnable` };
}

/**
 * A manifest pinned to `generic` on a tree that clearly has a stack means the real
 * sensors for that stack are simply absent — the gate runs, reports green, and has
 * checked almost nothing. `runSensors` self-heals this at run time via `reconcilePack`,
 * but only when a registry is reachable; saying it out loud here costs nothing.
 */
function checkPack(cwd: string, manifest: SensorManifest | null): PreflightCheck {
    if (!manifest) return { id: 'pack', ok: true, detail: 'skipped (no manifest)' };
    const detection = detectStack(cwd);
    if (manifest.pack === 'generic' && detection.pack !== 'generic') {
        return {
            id: 'pack',
            ok: false,
            detail: `manifest on 'generic' but the tree looks like '${detection.pack}' (${detection.indicators.join(', ')})`,
            remedy: 'run `awm sensors init` to pick up the real pack for this stack',
        };
    }
    return { id: 'pack', ok: true, detail: `${manifest.pack} matches the detected stack` };
}

/**
 * Advisory only — `ok` is ALWAYS `true` here, no matter what it finds. The
 * `finishing-a-development-branch`/`receiving-code-review` skills detect the git host
 * (GitHub vs GitLab) and shell out to `gh`/`glab` to open a PR/MR, degrading honestly
 * when neither is on PATH. This check tells the operator, in advance, whether that
 * downstream step will actually work — but plenty of legitimate workflows never create
 * a PR/MR at all (merge locally, keep the branch as-is), so gating the whole harness on
 * missing tooling here would be wrong. It is FYI, never a blocker.
 */
function checkHost(cwd: string): PreflightCheck {
    let remote: string;
    try {
        remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'], // no origin / not a repo prints to stderr — keep it off the operator's screen
        }).trim();
    } catch {
        // No `origin`, or not a git repo at all — nothing to advise on.
        return { id: 'host', ok: true, detail: 'no git remote detected — PR/MR automation not applicable' };
    }

    if (remote.includes('github.com')) {
        return resolveOnPath('gh')
            ? { id: 'host', ok: true, detail: 'github detected, gh available' }
            : {
                id: 'host',
                ok: true,
                detail: 'github detected, gh not on PATH — PR creation will require manual steps',
                remedy: 'install the GitHub CLI (gh), or PR creation will need to be done manually',
            };
    }

    if (remote.includes('gitlab')) {
        return resolveOnPath('glab')
            ? { id: 'host', ok: true, detail: 'gitlab detected, glab available' }
            : {
                id: 'host',
                ok: true,
                detail: 'gitlab detected, glab not on PATH — MR creation will require manual steps',
                remedy: 'install the GitLab CLI (glab), or MR creation will need to be done manually',
            };
    }

    // Bitbucket, Azure DevOps, an internal git server, etc. — don't overclaim support.
    return { id: 'host', ok: true, detail: 'git host not recognized (github/gitlab) — PR/MR automation not applicable' };
}

export function preflight(cwd: string = process.cwd()): PreflightReport {
    const manifest = readManifest(cwd);
    const manifestExists = fs.existsSync(path.join(cwd, MANIFEST));

    const checks: PreflightCheck[] = [
        checkContext(cwd),
        checkManifest(cwd, manifest),
        // Skipped when there is no manifest: reporting "tools broken" on a repo that was
        // never set up buries the one thing the operator needs to read.
        ...(manifestExists ? [checkTools(cwd), checkPack(cwd, manifest)] : []),
        // Runs unconditionally — orthogonal to sensor configuration entirely, this is
        // about PR/MR tooling, not sensors.
        checkHost(cwd),
    ];

    const status = !manifestExists ? 'not_configured'
        : checks.every(c => c.ok) ? 'ready'
        : 'degraded';

    return { status, checks };
}
