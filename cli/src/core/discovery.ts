// src/core/discovery.ts
import fs from 'fs';
import path from 'path';
import { contentRoots, readRegistryManifest } from './registries';

export interface SkillArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}

export interface WorkflowArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}

export interface AgentArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}

export function readArtifactDescription(filePath: string): string {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fmMatch) return '';
        const line = fmMatch[1]
            .split(/\r?\n/)
            .find((l) => /^description\s*:/.test(l));
        if (!line) return '';
        let val = line.replace(/^description\s*:/, '').trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        const BLOCK_INDICATORS = new Set(['>-', '>', '|-', '|', '>+', '|+']);
        if (BLOCK_INDICATORS.has(val.trim())) return '';
        return val.trim();
    } catch {
        return '';
    }
}

function collisionError(kind: string, name: string, first: string, second: string): Error {
    return new Error(
        `Artifact name collision: ${kind} "${name}" exists in both ${first} and ${second}. ` +
        `Remove or rename one of them, or declare "${name}" in "overrides" of the later registry's awm-registry.json.`
    );
}

interface DiscoveredEntry {
    name: string;
    path: string;
    description: string;
    overrode?: string;
}

/** Inserta o resuelve colisión: override declarado en el root posterior → reemplaza
 *  (Map.set sobre key existente conserva la posición de inserción); no declarado → error. */
function mergeEntry(
    kind: string,
    byName: Map<string, DiscoveredEntry>,
    entry: DiscoveredEntry,
    rootOverrides: Set<string>
): void {
    const prev = byName.get(entry.name);
    if (!prev) {
        byName.set(entry.name, entry);
        return;
    }
    if (rootOverrides.has(entry.name)) {
        byName.set(entry.name, { ...entry, overrode: prev.path });
        return;
    }
    throw collisionError(kind, entry.name, prev.path, entry.path);
}

/**
 * Scans skills directories across all provided content roots and returns all valid skills.
 * A valid skill is a directory that contains a SKILL.md file.
 * Throws on name collision across roots unless the later root declares the name in its awm-registry.json overrides.
 */
export function discoverSkills(roots: string[] = contentRoots()): SkillArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'skills');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillPath = path.join(dir, entry.name);
            if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue;
            mergeEntry('skill', byName, {
                name: entry.name,
                path: skillPath,
                description: readArtifactDescription(path.join(skillPath, 'SKILL.md')),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

/**
 * Scans workflows directories across all provided content roots and returns all valid workflows.
 * A valid workflow is a .md file.
 * Throws on name collision across roots unless the later root declares the name in its awm-registry.json overrides.
 */
export function discoverWorkflows(roots: string[] = contentRoots()): WorkflowArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'workflows');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            mergeEntry('workflow', byName, {
                name,
                path: filePath,
                description: readArtifactDescription(filePath),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

/**
 * Scans agents directories across all provided content roots and returns all valid agent profiles.
 * A valid agent is a .md file.
 * Throws on name collision across roots unless the later root declares the name in its awm-registry.json overrides.
 */
export function discoverAgents(roots: string[] = contentRoots()): AgentArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'agents');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            mergeEntry('agent', byName, {
                name,
                path: filePath,
                description: readArtifactDescription(filePath),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

