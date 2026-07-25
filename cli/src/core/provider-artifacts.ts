import fs from 'fs';
import path from 'path';
import {
    AgentTarget,
    ArtifactType,
    Scope,
    UnsupportedRendererError,
    assertLinkRenderer,
} from '../providers';

type ArtifactLike = {
    type: ArtifactType;
};

export type ArtifactTargetPair = {
    agent: AgentTarget;
    artifact: ArtifactLike;
};

export type LegacyArtifact = {
    name: string;
    type: ArtifactType;
    installedIn: AgentTarget[];
    fullPaths: string[];
};

const ARTIFACT_TYPES: readonly ArtifactType[] = ['skill', 'workflow', 'agent'];

export function preflightLinkArtifactPairs(
    pairs: readonly ArtifactTargetPair[],
): void {
    for (const { agent, artifact } of pairs) {
        assertLinkRenderer(artifact.type, agent);
    }
}

export function scanLegacyArtifacts(
    agents: readonly AgentTarget[],
    scope: Scope,
): LegacyArtifact[] {
    const artifacts = new Map<string, LegacyArtifact>();

    for (const agent of agents) {
        for (const type of ARTIFACT_TYPES) {
            let config;
            try {
                config = assertLinkRenderer(type, agent);
            } catch (error) {
                if (error instanceof UnsupportedRendererError) continue;
                throw error;
            }
            if (!config) continue;
            const dir = config[scope];
            if (!fs.existsSync(dir)) continue;

            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                const existing = artifacts.get(entry.name);
                if (existing) {
                    existing.installedIn.push(agent);
                    existing.fullPaths.push(fullPath);
                } else {
                    artifacts.set(entry.name, {
                        name: entry.name,
                        type,
                        installedIn: [agent],
                        fullPaths: [fullPath],
                    });
                }
            }
        }
    }

    return Array.from(artifacts.values());
}
