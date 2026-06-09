// src/core/discovery.ts
import fs from 'fs';
import path from 'path';
import { REGISTRY_DIR } from './registry';
import { contentRoots } from './registries';

export const SKILLS_DIR = path.join(REGISTRY_DIR, 'registry', 'skills');
export const WORKFLOWS_DIR = path.join(REGISTRY_DIR, 'registry', 'workflows');
export const AGENTS_DIR = path.join(REGISTRY_DIR, 'registry', 'agents');

export interface SkillArtifact {
    name: string;
    path: string;
    description: string;
}

export interface WorkflowArtifact {
    name: string;
    path: string;
    description: string;
}

export interface AgentArtifact {
    name: string;
    path: string;
    description: string;
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
        `Remove or rename one of them (per-registry namespacing llega en WS-2).`
    );
}

/**
 * Scans skills directories across all provided content roots and returns all valid skills.
 * A valid skill is a directory that contains a SKILL.md file.
 * Throws on name collision across roots.
 */
export function discoverSkills(roots: string[] = contentRoots()): SkillArtifact[] {
    const out: SkillArtifact[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        const dir = path.join(root, 'skills');
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillPath = path.join(dir, entry.name);
            if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue;
            const prev = seen.get(entry.name);
            if (prev) throw collisionError('skill', entry.name, prev, skillPath);
            seen.set(entry.name, skillPath);
            out.push({
                name: entry.name,
                path: skillPath,
                description: readArtifactDescription(path.join(skillPath, 'SKILL.md')),
            });
        }
    }
    return out;
}

/**
 * Scans workflows directories across all provided content roots and returns all valid workflows.
 * A valid workflow is a .md file.
 * Throws on name collision across roots.
 */
export function discoverWorkflows(roots: string[] = contentRoots()): WorkflowArtifact[] {
    const out: WorkflowArtifact[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        const dir = path.join(root, 'workflows');
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            const prev = seen.get(name);
            if (prev) throw collisionError('workflow', name, prev, filePath);
            seen.set(name, filePath);
            out.push({ name, path: filePath, description: readArtifactDescription(filePath) });
        }
    }
    return out;
}

/**
 * Scans agents directories across all provided content roots and returns all valid agent profiles.
 * A valid agent is a .md file.
 * Throws on name collision across roots.
 */
export function discoverAgents(roots: string[] = contentRoots()): AgentArtifact[] {
    const out: AgentArtifact[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        const dir = path.join(root, 'agents');
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            const prev = seen.get(name);
            if (prev) throw collisionError('agent', name, prev, filePath);
            seen.set(name, filePath);
            out.push({ name, path: filePath, description: readArtifactDescription(filePath) });
        }
    }
    return out;
}

