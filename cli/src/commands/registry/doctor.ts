import fs from 'fs';
import path from 'path';
import { parseFactsCatalog } from '../../core/facts/catalog';
import { findOrphanNeeds, readSkillNeeds } from '../../core/facts/needs';
import { FACTS_MIN_CLI_VERSION, FactsCatalog, SkillNeedsError } from '../../core/facts/types';
import { readCatalog } from '../../core/bundles';
import { readRegistryManifest } from '../../core/registries';
import { compareSemver } from '../../core/versioning';

export interface DoctorReport {
    structural: string[];
    advisories: string[];
}

/** Capability ids the doctor understands in v1; others are advisory (forward-compatible). */
const KNOWN_CAPABILITY_IDS = new Set(['facts']);

const CAPABILITIES_HEADER_RE = /^\|\s*id\s*\|\s*status\s*\|\s*notes\s*\|$/i;
const HOME_PATH_RE = /(^|[^\w])~(\/|\\)/;
const USERS_PATH_RE = /\/Users\/[^/\s]+/;
const ADVISORY_CAP = 50;

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function walkFiles(root: string, visit: (abs: string, rel: string) => void): void {
    const stack: string[] = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            const abs = path.join(dir, entry.name);
            let stat: fs.Stats;
            try {
                stat = fs.lstatSync(abs);
            } catch {
                continue;
            }
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) {
                stack.push(abs);
                continue;
            }
            if (stat.isFile()) {
                visit(abs, path.relative(root, abs));
            }
        }
    }
}

interface CapabilitiesIndex {
    rows: Array<{ id: string; status: string; notes: string }>;
    errors: string[];
}

function parseCapabilitiesIndex(markdown: string): CapabilitiesIndex {
    const lines = markdown.split(/\r?\n/);
    const headingIdx = lines.findIndex((l) => /^##\s+Capabilities\s*$/i.test(l.trim()));
    if (headingIdx === -1) {
        return { rows: [], errors: ['REGISTRY.md missing ## Capabilities section'] };
    }
    let headerIdx = -1;
    for (let i = headingIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^##\s+/.test(line)) break;
        if (CAPABILITIES_HEADER_RE.test(line)) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) {
        return {
            rows: [],
            errors: ['REGISTRY.md Capabilities index missing | id | status | notes | header'],
        };
    }
    const rows: CapabilitiesIndex['rows'] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (line === '') continue;
        if (/^##\s+/.test(line)) break;
        if (!line.startsWith('|')) continue;
        if (/^\|\s*-+/.test(line)) continue; // separator row
        const cells = line
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim());
        if (cells.length < 3) {
            errors.push(`Capabilities row malformed: ${line}`);
            continue;
        }
        const id = cells[0];
        if (id === '') {
            errors.push('Capabilities table has empty id');
            continue;
        }
        if (seen.has(id)) {
            errors.push(`Capabilities table duplicate id "${id}"`);
            continue;
        }
        seen.add(id);
        rows.push({ id, status: cells[1] ?? '', notes: cells[2] ?? '' });
    }
    return { rows, errors };
}

function collectSkillMdPaths(root: string): string[] {
    const skillsRoot = path.join(root, 'skills');
    const out: string[] = [];
    if (!fs.existsSync(skillsRoot)) return out;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const skillMd = path.join(skillsRoot, entry.name, 'SKILL.md');
        try {
            const stat = fs.lstatSync(skillMd);
            if (stat.isFile() && !stat.isSymbolicLink()) out.push(skillMd);
        } catch {
            // unreadable → fail closed as structural when needs are required elsewhere
        }
    }
    return out;
}

function scanEnvStoreInTree(root: string, structural: string[]): void {
    walkFiles(root, (abs, rel) => {
        const parts = rel.split(/[/\\]/);
        const envIdx = parts.findIndex((p) => p === 'environments');
        const base = path.basename(abs);
        if (envIdx !== -1 && (base === 'values.json' || base === 'meta.json')) {
            structural.push(
                `Environment store file must not live in the registry tree: ${rel} (RF-4.5)`,
            );
            return;
        }
        // Copied ~/.awm/environments layout without the segment being under a clear env dir name
        if (base === 'values.json' && parts.includes('environments')) {
            structural.push(
                `Environment store file must not live in the registry tree: ${rel} (RF-4.5)`,
            );
        }
    });
}

function scanProsePathHints(root: string, advisories: string[]): void {
    const skillsRoot = path.join(root, 'skills');
    if (!fs.existsSync(skillsRoot)) return;
    walkFiles(skillsRoot, (abs, rel) => {
        if (!abs.endsWith('.md')) return;
        if (advisories.length >= ADVISORY_CAP) return;
        let text: string;
        try {
            text = fs.readFileSync(abs, 'utf-8');
        } catch {
            return;
        }
        for (const line of text.split(/\r?\n/)) {
            if (advisories.length >= ADVISORY_CAP) return;
            if (HOME_PATH_RE.test(line) || USERS_PATH_RE.test(line)) {
                advisories.push(
                    `Possible machine path in ${rel}: prefer a fact (e.g. ~/Developments or /Users/…)`,
                );
                break;
            }
        }
    });
}

function checkVersionCoherence(root: string, structural: string[]): void {
    let entries;
    try {
        entries = readCatalog(root);
    } catch (e) {
        structural.push(`catalog.json unreadable: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    for (const entry of entries) {
        if (typeof entry.version !== 'string') continue;
        const bundlePath = path.join(root, entry.source, 'bundle.json');
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(bundlePath);
        } catch (error) {
            if (isMissing(error)) continue;
            structural.push(`Cannot inspect ${path.relative(root, bundlePath)}`);
            continue;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        let raw: unknown;
        try {
            raw = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
        } catch (e) {
            structural.push(
                `bundle.json invalid at ${path.relative(root, bundlePath)}: ${e instanceof Error ? e.message : String(e)}`,
            );
            continue;
        }
        const bundleVersion =
            raw !== null && typeof raw === 'object' && typeof (raw as { version?: unknown }).version === 'string'
                ? (raw as { version: string }).version
                : undefined;
        if (bundleVersion !== undefined && bundleVersion !== entry.version) {
            structural.push(
                `Bundle "${entry.name}" version skew: catalog=${entry.version} bundle.json=${bundleVersion} (RF-4.7)`,
            );
        }
    }
}

/**
 * Structural + advisory audit of a registry tree. Path-only API (RF-5.1) — schema/doctor are the gates.
 */
export function doctorRegistry(root: string): DoctorReport {
    const structural: string[] = [];
    const advisories: string[] = [];
    const resolvedRoot = path.resolve(root);

    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        return { structural: [`Registry root does not exist or is not a directory: ${resolvedRoot}`], advisories };
    }

    let manifestMin: string | undefined;
    try {
        const manifest = readRegistryManifest(resolvedRoot);
        manifestMin = manifest.minCliVersion;
    } catch (e) {
        structural.push(`awm-registry.json invalid: ${e instanceof Error ? e.message : String(e)}`);
    }

    const handbookPath = path.join(resolvedRoot, 'REGISTRY.md');
    if (!fs.existsSync(handbookPath)) {
        structural.push('missing REGISTRY.md');
    } else {
        let handbook: string;
        try {
            handbook = fs.readFileSync(handbookPath, 'utf-8');
        } catch (e) {
            structural.push(`Cannot read REGISTRY.md: ${e instanceof Error ? e.message : String(e)}`);
            handbook = '';
        }
        if (handbook) {
            const caps = parseCapabilitiesIndex(handbook);
            structural.push(...caps.errors);
            for (const row of caps.rows) {
                if (!KNOWN_CAPABILITY_IDS.has(row.id)) {
                    if (advisories.length < ADVISORY_CAP) {
                        advisories.push(`Unknown capability id "${row.id}" in REGISTRY.md (advisory; RF-4.6)`);
                    }
                }
            }
        }
    }

    checkVersionCoherence(resolvedRoot, structural);
    scanEnvStoreInTree(resolvedRoot, structural);

    const factsPath = path.join(resolvedRoot, 'facts.json');
    let catalog: FactsCatalog | null = null;
    let factsPresent = false;
    if (fs.existsSync(factsPath)) {
        factsPresent = true;
        try {
            catalog = parseFactsCatalog(factsPath);
        } catch (e) {
            structural.push(`facts.json invalid: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    const skillPaths = collectSkillMdPaths(resolvedRoot);
    let anyNeeds = false;
    for (const skillMd of skillPaths) {
        let needs: string[];
        try {
            needs = readSkillNeeds(skillMd);
        } catch (e) {
            if (e instanceof SkillNeedsError) {
                structural.push(e.message);
                continue;
            }
            structural.push(`Cannot read needs from ${path.relative(resolvedRoot, skillMd)}`);
            continue;
        }
        if (needs.length === 0) continue;
        anyNeeds = true;
        if (!catalog) {
            structural.push(
                `Skill ${path.relative(resolvedRoot, skillMd)} declares needs but facts.json is missing (fail closed)`,
            );
            continue;
        }
        const orphans = findOrphanNeeds(needs, catalog);
        for (const id of orphans) {
            structural.push(
                `Orphan need "${id}" in ${path.relative(resolvedRoot, skillMd)} — not in facts.json (RF-1.3)`,
            );
        }
    }

    if (factsPresent || anyNeeds) {
        if (!manifestMin) {
            structural.push(
                `minCliVersion required when facts/needs are present (must be >= ${FACTS_MIN_CLI_VERSION}) (RF-4.8)`,
            );
        } else {
            try {
                if (compareSemver(manifestMin, FACTS_MIN_CLI_VERSION) < 0) {
                    structural.push(
                        `minCliVersion ${manifestMin} is below FACTS_MIN_CLI_VERSION ${FACTS_MIN_CLI_VERSION} (RF-4.8)`,
                    );
                }
            } catch (e) {
                structural.push(
                    `minCliVersion unreadable for facts gate: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    }

    scanProsePathHints(resolvedRoot, advisories);

    return { structural, advisories };
}
