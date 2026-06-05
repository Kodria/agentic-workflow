// src/core/init/detector.ts
import fs from 'fs';
import path from 'path';

export interface DetectionResult {
    proposed: string[];   // bundles 'project' detectados
    signals: string[];    // evidencia legible
    deferred: string[];   // señales sin bundle aún
}

const FRONTEND_DEPS = ['next', 'react', 'vue', 'astro', 'svelte'];
const FRONTEND_DIRS = ['pages', 'app', 'landing'];
const DOCS_CONFIGS = ['mkdocs.yml', 'docusaurus.config.js', 'docusaurus.config.ts'];
const INFRA_MARKERS = ['Dockerfile', 'helm', 'terraform'];

function readPackageDeps(root: string): { deps: Record<string, string>; found: boolean } {
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) return { deps: {}, found: false };
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return { deps: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }, found: true };
    } catch {
        return { deps: {}, found: true };
    }
}

function docsHasContent(root: string): boolean {
    const docsDir = path.join(root, 'docs');
    if (!fs.existsSync(docsDir) || !fs.statSync(docsDir).isDirectory()) return false;
    const mdFiles = fs.readdirSync(docsDir).filter((f) => f.toLowerCase().endsWith('.md'));
    // Un README suelto no cuenta; requiere config (manejada aparte) o ≥2 markdown.
    return mdFiles.length >= 2;
}

export function detectExtensions(root: string): DetectionResult {
    const proposed: string[] = [];
    const signals: string[] = [];
    const deferred: string[] = [];

    // frontend
    const { deps } = readPackageDeps(root);
    const frontDep = FRONTEND_DEPS.find((d) => d in deps);
    const frontDir = FRONTEND_DIRS.find((d) => fs.existsSync(path.join(root, d)) && fs.statSync(path.join(root, d)).isDirectory());
    if (frontDep || frontDir) {
        proposed.push('frontend');
        signals.push(frontDep ? `${frontDep} (package.json)` : `${frontDir}/`);
    }

    // docs
    const docsConfig = DOCS_CONFIGS.find((c) => fs.existsSync(path.join(root, c)));
    if (docsConfig) {
        proposed.push('docs');
        signals.push(`${docsConfig}`);
    } else if (docsHasContent(root)) {
        proposed.push('docs');
        signals.push('docs/ (≥2 .md)');
    }

    // infra (deferred — sin bundle aún)
    let k8s = false;
    try { k8s = fs.readdirSync(root).some((f) => f.endsWith('.k8s.yaml')); } catch { /* directory vanished */ }
    const infraMarker = INFRA_MARKERS.find((m) => fs.existsSync(path.join(root, m)));
    if (k8s || infraMarker) {
        deferred.push('infra (Fase futura)');
    }

    return { proposed, signals, deferred };
}
