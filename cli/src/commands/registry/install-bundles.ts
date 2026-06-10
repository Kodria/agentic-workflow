// cli/src/commands/registry/install-bundles.ts
// Instalación de bundles de un registry recién agregado (flujo post-add).
// Separado del wiring de commander para ser testeable sin prompts.
import { discoverAllBundles, discoverBundles } from '../../core/bundles';
import { addBundle } from '../../core/bundle-install';
import { AgentTarget } from '../../providers';

export interface RegistryBundleInstallResult {
    bundle: string;
    installed: string[];
    skipped: string[];
}

/** Bundles disponibles en un content root concreto (candidatos a instalar tras el add).
 * Uses single-root discovery to avoid surfacing cross-registry collision errors here. */
export function bundlesInRegistry(contentRoot: string): string[] {
    return discoverBundles(contentRoot).map((b) => b.name);
}

/**
 * Instala bundles del registry `contentRoot` para los agentes dados.
 * `selection` = 'all' instala todos los del registry; una lista instala solo esos.
 * Las dependencias se resuelven contra TODOS los roots (pueden vivir en el base).
 */
export function installBundlesFromRegistry(
    contentRoot: string,
    selection: string[] | 'all',
    agents: AgentTarget[],
    projectRoot: string
): RegistryBundleInstallResult[] {
    const allBundles = discoverAllBundles();
    const candidates = allBundles.filter((b) => b.contentRoot === contentRoot);
    const wanted =
        selection === 'all' ? candidates : candidates.filter((b) => selection.includes(b.name));

    const results: RegistryBundleInstallResult[] = [];
    for (const b of wanted) {
        const summary = addBundle({
            bundleName: b.name,
            bundles: allBundles,
            agents,
            method: 'symlink',
            projectRoot,
        });
        results.push({ bundle: b.name, installed: summary.installed, skipped: summary.skipped });
    }
    return results;
}
