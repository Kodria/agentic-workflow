// Estado de los overrides declarados por un registry: activo (tapa un artifact
// de un root anterior) o sin efecto (huérfano — el nombre ya no existe upstream).
import { readRegistryManifest } from '../../core/registries';
import { discoverSkills, discoverWorkflows, discoverAgents } from '../../core/discovery';
import { discoverAllBundles } from '../../core/bundles';

export interface OverrideStatus {
    name: string;
    active: boolean;
}

function artifactNamesInRoot(root: string): Set<string> {
    const names = new Set<string>();
    for (const s of discoverSkills([root])) names.add(s.name);
    for (const w of discoverWorkflows([root])) names.add(w.name);
    for (const a of discoverAgents([root])) names.add(a.name);
    for (const b of discoverAllBundles([root])) names.add(b.name);
    return names;
}

export function overrideStatus(contentRoot: string, earlierRoots: string[]): OverrideStatus[] {
    const declared = Array.from(readRegistryManifest(contentRoot).overrides);
    if (declared.length === 0) return [];
    const earlier = new Set<string>();
    for (const root of earlierRoots) {
        for (const n of artifactNamesInRoot(root)) earlier.add(n);
    }
    return declared.map((name) => ({ name, active: earlier.has(name) }));
}
