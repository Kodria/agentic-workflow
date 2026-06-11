// src/core/diagnostics/types.ts
import { AgentTarget } from '../../providers';
import { InjectionState } from '../context/types';

export type CheckLevel = 'machine' | 'project';
export type CheckStatus = 'ok' | 'warn' | 'missing'; // ✔ / ⚠ / ✖
export type GitState = 'clean' | 'behind' | 'dirty' | 'unknown';

// Frontera CLI↔agente codificada en los datos.
export type Remedy =
    | { kind: 'command'; value: string }   // accionable por init (1d)
    | { kind: 'skill'; value: string }     // lo redacta el agente
    | { kind: 'none' };                    // ok, sin acción

export interface CheckResult {
    id: string;            // estable: 'machine.hook', 'project.constitution', …
    level: CheckLevel;
    label: string;
    status: CheckStatus;
    detail?: string;
    remedy: Remedy;
}

export interface MachineFacts {
    registryCache: { present: boolean; gitState?: GitState };
    hook: { present: boolean; degraded?: boolean };
    devCore: { present: boolean; brokenLinks: string[] };
    ambient: { wanted: string[]; installed: string[] };
    contextInjection: { agent: AgentTarget; state: InjectionState }[];
    globalSkills: { valid: string[]; repairable: string[]; dead: string[] };
}

export interface ProjectFacts {
    root: string;
    profile: { present: boolean; extensions: string[] };
    activeBundles: { expected: string[]; linked: string[]; broken: string[] };
    sensors: { present: boolean };
    constitution: { present: boolean };
    context: { present: boolean; file?: 'CLAUDE.md' | 'AGENTS.md' };
}

export interface HarnessContext {
    machine: MachineFacts;
    project: ProjectFacts | null;
}

export interface CheckReport {
    results: CheckResult[];
    overall: 'healthy' | 'degraded';
    hasProject: boolean;
    projectName?: string;
}
