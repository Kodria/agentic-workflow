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
import { AgentTarget, providerFor } from '../../providers';

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
 */
function hashDirectoryTree(dir: string): string {
    let entries: string[];
    try {
        entries = fs.readdirSync(dir).sort();
    } catch {
        return 'unreadable';
    }
    const parts = entries.map((name) => {
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
            return `${name}:d:${hashDirectoryTree(p)}`;
        }
        try {
            return `${name}:f:${hashFileContent(p)}`;
        } catch {
            return `${name}:f:unreadable`;
        }
    });
    return parts.join('|');
}

function hashPath(target: string): string {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(target);
    } catch {
        return 'absent';
    }
    if (stat.isSymbolicLink()) {
        return `symlink:${fs.readlinkSync(target)}`;
    }
    if (stat.isDirectory()) {
        return `dir:${hashDirectoryTree(target)}`;
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
        if (provider.injection.type === 'managed-agents-md') paths.add(provider.injection.globalPath);
    }
    if (provider.skill) paths.add(provider.skill.global);
    if (provider.workflow) paths.add(provider.workflow.global);
    if (provider.agent) paths.add(provider.agent.global);
    return Array.from(paths).sort();
}

/** Snapshots `agent`'s managed AWM state. Pure read — never writes. */
export function gatherProviderFacts(agent: AgentTarget): ProviderFacts {
    const paths = providerManagedPaths(agent);
    const hash = crypto.createHash('sha256');
    for (const p of paths) {
        hash.update(p).update('\0').update(hashPath(p)).update('\0');
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
