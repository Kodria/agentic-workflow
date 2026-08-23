/** Máximo schema que este CLI sabe evaluar. Solo crece (R1.3). */
export const KNOWN_PROCESS_SCHEMA = 1;

export type ProcessStatus = 'draft' | 'active';

export interface ProcessModelFrontmatter {
    schema: number;
    name: string;
    status: ProcessStatus;
    entryPoint: boolean;
    terminatesTo: string;
    created: string;
    updated: string;
}

export interface ProcessRoutingRow {
    when: string;
    requiredState: string;
    goesTo: string;
    endsAt: string;
}

export interface ProcessOperation { id: string; text: string }
export interface ProcessSubgoal { id: string; text: string; operations: ProcessOperation[] }

export interface ProcessModelBody {
    objective: string;
    appliesWhen: string;
    structure: ProcessSubgoal[];
    routing: ProcessRoutingRow[];
    termination: string;
    unverified: string[];
}

export interface ProcessModel extends ProcessModelFrontmatter {
    /** Path del SKILL.md del que salió. El modelo ES el SKILL.md (R1.1). */
    source: string;
    body: ProcessModelBody;
}

export interface ProcessParseResult<T> { model?: T; diagnostics: string[] }
