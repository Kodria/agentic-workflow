// src/core/init/provider-facts.ts
//
// R19's "Claude baseline is read-only" guarantee: when `awm init` targets a
// non-Claude agent (today: Codex), nothing this run does may change what's
// already managed for claude-code. `gatherProviderFacts` snapshots every path
// Claude's own init run would touch (hooks, skill/agent dirs, injection);
// `assertClaudeBaselinePreserved` compares a before/after pair and throws if
// anything moved. Directories are hashed by recursively walking the full tree
// and folding in every nested file's own content hash — this is an absolute
// safety invariant (R19), so a mutation nested arbitrarily deep under a
// managed directory (e.g. a `copy`-mode global install materializing a
// nested source tree) must still be detected, not just a top-level stat
// summary. These are small, provider-managed directories (skills/agents/
// hook scripts), never arbitrary user content, so full content hashing stays
// cheap.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AGENT_TARGETS, AgentTarget, providerFor } from '../../providers';

export type ProviderFacts = {
    agent: AgentTarget;
    /** Paths inspected, sorted — informational, useful in error messages/debugging. */
    paths: string[];
    /** Combined hash of every inspected path's content (or 'absent'). */
    hash: string;
};

function hashFileContent(target: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

/**
 * Recursively walks `dir`, producing a digest that changes if ANY nested
 * file's content changes at ANY depth, or any entry is added/removed/renamed/
 * changes kind (file/dir/symlink) — not just the top-level entries.
 *
 * `exclude` names absolute paths to omit entirely — not just their content,
 * but their very presence as an entry — from the hash. This exists because
 * Codex's hook scripts directory (`~/.awm/hooks/codex/`) is physically NESTED
 * inside Claude's own hook scripts directory (`~/.awm/hooks/` —
 * providers/index.ts), so a naive full recursive hash of Claude's scriptsDir
 * would flag a REAL Codex hook install as "Claude's baseline changed" — first
 * by content, and (if merely masked to a placeholder rather than fully
 * dropped) still by the sibling directory's mere appearance/disappearance as
 * an entry — either way making R19's guard permanently unsatisfiable for any
 * Codex init that actually installs its hook (caught via Task 9's real
 * end-to-end init test). Fully omitting another agent's own managed paths
 * keeps the guard scoped to what it's meant to protect — content Claude
 * itself owns — without weakening it for genuine Claude-owned changes.
 */
function hashDirectoryTree(dir: string, exclude: Set<string>): string {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir).sort();
    } catch {
        return 'unreadable';
    }
    const parts = entries
        .filter((name) => !exclude.has(path.resolve(path.join(dir, name))))
        .map((name) => {
            const p = path.join(dir, name);
            let s: fs.Stats;
            try {
                s = fs.lstatSync(p);
            } catch {
                return `${name}:missing`;
            }
            if (s.isSymbolicLink()) {
                try {
                    return `${name}:l:${fs.readlinkSync(p)}`;
                } catch {
                    return `${name}:l:unreadable`;
                }
            }
            if (s.isDirectory()) {
                return `${name}:d:${hashDirectoryTree(p, exclude)}`;
            }
            try {
                return `${name}:f:${hashFileContent(p)}`;
            } catch {
                return `${name}:f:unreadable`;
            }
        });
    return parts.join('|');
}

/** Canonical digest for "this agent owns nothing here" — see hashPath. */
const NO_CONTENT = 'absent';

function hashPath(target: string, exclude: Set<string>): string {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(target);
    } catch {
        return NO_CONTENT;
    }
    if (stat.isSymbolicLink()) {
        return `symlink:${fs.readlinkSync(target)}`;
    }
    if (stat.isDirectory()) {
        const tree = hashDirectoryTree(target, exclude);
        // A managed directory that exists but holds nothing this agent owns is
        // indistinguishable, for R19's purposes, from one that doesn't exist:
        // either way Claude has no hook, no skill and no agent installed there.
        // Collapsing both to one digest is what makes a Codex-only bootstrap
        // possible — Codex's scriptsDir (~/.awm/hooks/codex) is nested inside
        // Claude's (~/.awm/hooks), so installing the Codex hook necessarily
        // creates Claude's directory via `mkdirSync(..., {recursive: true})`
        // (commands/hooks/shared.ts). On a machine that never ran a Claude
        // init, that flipped Claude's digest from absent to `dir:` and aborted
        // every `awm init --agent codex` — the exact fresh-cloud-box scenario
        // Codex Cloud boots into. Genuine changes still register: content
        // appearing here, or being emptied out, both move the digest.
        return tree === '' ? NO_CONTENT : `dir:${tree}`;
    }
    return `file:${hashFileContent(target)}`;
}

/** Paths that materially represent `agent`'s managed AWM state (hook, injection, artifact dirs). */
function providerManagedPaths(agent: AgentTarget): string[] {
    const provider = providerFor(agent);
    const paths = new Set<string>();
    if (provider.hooks) {
        paths.add(provider.hooks.settingsPath);
        paths.add(provider.hooks.scriptsDir);
    }
    if (provider.injection) {
        if (provider.injection.type === 'config-instructions') paths.add(provider.injection.configPath);
        if (provider.injection.type === 'managed-agents-md' && provider.injection.globalPath !== null) {
            paths.add(provider.injection.globalPath);
        }
    }
    if (provider.skill && provider.skill.global !== null) paths.add(provider.skill.global);
    if (provider.workflow && provider.workflow.global !== null) paths.add(provider.workflow.global);
    if (provider.agent && provider.agent.global !== null) paths.add(provider.agent.global);
    return Array.from(paths).sort();
}

/** Every OTHER agent's own managed paths, resolved — see hashDirectoryTree's docstring:
 *  these get excluded from `agent`'s recursive hash so a sibling agent's writes to a
 *  path nested inside `agent`'s own managed directory (Codex's scriptsDir under
 *  Claude's, today) don't register as a change to `agent`'s baseline. */
function otherAgentManagedPaths(agent: AgentTarget): Set<string> {
    const out = new Set<string>();
    for (const other of AGENT_TARGETS) {
        if (other === agent) continue;
        for (const p of providerManagedPaths(other)) out.add(path.resolve(p));
    }
    return out;
}

/** Snapshots `agent`'s managed AWM state. Pure read — never writes. */
export function gatherProviderFacts(agent: AgentTarget): ProviderFacts {
    const paths = providerManagedPaths(agent);
    const exclude = otherAgentManagedPaths(agent);
    const hash = crypto.createHash('sha256');
    for (const p of paths) {
        hash.update(p).update('\0').update(hashPath(p, exclude)).update('\0');
    }
    return { agent, paths, hash: hash.digest('hex') };
}

/**
 * Throws when `before`/`after` diverge — i.e. Claude's managed state changed
 * during an init run that targeted a different agent. `before`/`after` must
 * both be for the SAME agent (mismatched agents is a caller bug, not a
 * baseline violation, so it throws a distinct message).
 */
export function assertClaudeBaselinePreserved(before: ProviderFacts, after: ProviderFacts): void {
    if (before.agent !== after.agent) {
        throw new Error(
            `assertClaudeBaselinePreserved: mismatched agents (${before.agent} vs ${after.agent})`,
        );
    }
    if (before.hash !== after.hash) {
        throw new Error(
            `Claude Code baseline changed during a non-Claude init — this must never happen (R19). ` +
            `Inspected: ${before.paths.join(', ')}`,
        );
    }
}
