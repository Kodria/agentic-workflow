// src/core/discovery.ts
import fs from 'fs';
import path from 'path';
import { REGISTRY_DIR } from './registry';

export const SKILLS_DIR = path.join(REGISTRY_DIR, 'registry', 'skills');
export const WORKFLOWS_DIR = path.join(REGISTRY_DIR, 'registry', 'workflows');
export const AGENTS_DIR = path.join(REGISTRY_DIR, 'registry', 'agents');
export const PROCESSES_FILE = path.join(REGISTRY_DIR, 'registry', 'processes.json');

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

export interface ProcessDefinition {
    name: string;
    description: string;
    skills: string[];
    workflows: string[];
    agents?: string[];
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

/**
 * Scans the registry's skills directory and returns all valid skills.
 * A valid skill is a directory that contains a SKILL.md file.
 */
export function discoverSkills(): SkillArtifact[] {
    if (!fs.existsSync(SKILLS_DIR)) return [];

    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
        .map((entry) => ({
            name: entry.name,
            path: path.join(SKILLS_DIR, entry.name),
            description: readArtifactDescription(path.join(SKILLS_DIR, entry.name, 'SKILL.md')),
        }));
}

/**
 * Scans the registry's workflows directory and returns all valid workflows.
 * A valid workflow is a .md file.
 */
export function discoverWorkflows(): WorkflowArtifact[] {
    if (!fs.existsSync(WORKFLOWS_DIR)) return [];

    const entries = fs.readdirSync(WORKFLOWS_DIR, { withFileTypes: true });

    return entries
        .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md'))
        .map((entry) => ({
            name: entry.name.replace('.md', ''),
            path: path.join(WORKFLOWS_DIR, entry.name),
            description: readArtifactDescription(path.join(WORKFLOWS_DIR, entry.name)),
        }));
}

/**
 * Scans the registry's agents directory and returns all valid agent profiles.
 * A valid agent is a .md file.
 */
export function discoverAgents(): AgentArtifact[] {
    if (!fs.existsSync(AGENTS_DIR)) return [];

    const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });

    return entries
        .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md'))
        .map((entry) => ({
            name: entry.name.replace('.md', ''),
            path: path.join(AGENTS_DIR, entry.name),
            description: readArtifactDescription(path.join(AGENTS_DIR, entry.name)),
        }));
}

/**
 * Parses the processes.json file and returns all available processes.
 */
export function discoverProcesses(): ProcessDefinition[] {
    if (!fs.existsSync(PROCESSES_FILE)) return [];

    const raw = fs.readFileSync(PROCESSES_FILE, 'utf-8');
    return JSON.parse(raw) as ProcessDefinition[];
}
