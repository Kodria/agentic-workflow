import fs from 'fs';
import path from 'path';
import {
    AgentTarget,
    ArtifactType,
    Scope,
    UnsupportedRendererError,
    assertLinkRenderer,
    providerFor,
} from '../providers';
import { ManagedArtifactRecord, readArtifactState } from './artifact-state';

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

/**
 * Artefactos instalados que AWM puede ofrecer para remover.
 *
 * Cuatro defectos corregidos aca, todos con perdida de datos o no-operacion:
 *
 *  1. **Clave por nombre solo**, a traves de TODOS los tipos y agentes. Un
 *     workflow `deploy.md` de antigravity y un agent `deploy.md` de claude-code
 *     colapsaban en UNA entrada, asi que elegir "deploy.md" borraba los dos. El
 *     escritor (`planInstall`) siempre clavea por ubicacion fisica.
 *  2. **Scope local resuelto contra `process.cwd()`**: `config.local` es
 *     relativo (`.claude/skills`), asi que desde un subdirectorio no encontraba
 *     nada, y cuando encontraba algo le pasaba una ruta RELATIVA a `fs.rmSync`.
 *     Ahora recibe el projectRoot explicito, como todos los demas consumidores.
 *  3. **Listaba el directorio entero**, ofreciendo borrar skills que el usuario
 *     escribio a mano. Ahora se cruza contra `readArtifactState()`: solo se
 *     ofrece lo que AWM realmente instalo. El registro de propiedad existe
 *     justamente para poder distinguirlo.
 *  4. **Se tragaba `UnsupportedRendererError`**, asi que era un no-op permanente
 *     para skills de cursor/copilot y agents de codex: `awm remove -a cursor`
 *     decia "no hay artefactos instalados" con el directorio lleno.
 */
export function scanLegacyArtifacts(
    agents: readonly AgentTarget[],
    scope: Scope,
    projectRoot: string = process.cwd(),
    owned: ManagedArtifactRecord[] = readArtifactState(),
): LegacyArtifact[] {
    const artifacts = new Map<string, LegacyArtifact>();
    const ownedPaths = new Set(owned.map((r) => path.resolve(r.targetPath)));

    for (const agent of agents) {
        for (const type of ARTIFACT_TYPES) {
            const config = providerFor(agent)[type];
            if (!config) continue;
            // Se usa la config del provider directamente: `assertLinkRenderer`
            // TIRA para renderers que producen contenido, y atrapar ese throw
            // convertia a cursor/copilot/codex en invisibles para `awm remove`.
            const dir = scope === 'local' ? path.join(projectRoot, config.local) : config.global;
            if (dir === null || !fs.existsSync(dir)) continue;

            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                // Solo lo que AWM instalo. Un archivo del usuario en el mismo
                // directorio no es nuestro para ofrecerlo en un menu de borrado.
                if (!ownedPaths.has(path.resolve(fullPath))) continue;
                // Clave por TIPO + nombre: dos artefactos de tipos distintos con
                // el mismo nombre son cosas distintas en lugares distintos.
                const key = `${type}\u0000${entry.name}`;
                const existing = artifacts.get(key);
                if (existing) {
                    existing.installedIn.push(agent);
                    existing.fullPaths.push(fullPath);
                } else {
                    artifacts.set(key, {
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
