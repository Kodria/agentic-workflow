// src/providers/index.ts
import os from 'os';
import path from 'path';

export type AgentTarget = 'antigravity' | 'opencode';
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow';

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    const homedir = os.homedir();
    
    if (agent === 'antigravity') {
        if (type === 'skill') {
            return scope === 'global' ? path.join(homedir, '.agents/skills') : '.agents/skills';
        } else {
            return scope === 'global' ? path.join(homedir, '.gemini/antigravity/global_workflows') : '.agents/workflows';
        }
    } 
    
    if (agent === 'opencode') {
        if (type === 'workflow') {
            throw new Error('Workflows are not natively supported by OpenCode.');
        }
        return scope === 'global' ? path.join(homedir, '.agents/skills') : '.agents/skills';
    }

    throw new Error('Unknown agent Target');
}
