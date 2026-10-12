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

/** Exit code for CLI: structural failures → 1; advisories alone → 0. */
export function doctorExitCode(report: DoctorReport): 0 | 1 {
    return report.structural.length ? 1 : 0;
}

/** Capability ids the doctor understands in v1; others are advisory (forward-compatible). */
const KNOWN_CAPABILITY_IDS = new Set(['facts']);

const CAPABILITIES_HEADER_RE = /^\|\s*id\s*\|\s*status\s*\|\s*notes\s*\|$/i;
const HOME_PATH_RE = /(^|[^\w])~(\/|\\)/;
const USERS_PATH_RE = /\/Users\/[^/\s]+/;
const ADVISORY_CAP = 50;
const STORE_BASENAMES = new Set(['values.json', 'meta.json']);

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function walkRegularFiles(root: string, visit: (abs: string, rel: string) => void): void {
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
        const line = lines[i].trim();
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

/** Collect readable regular SKILL.md paths; symlink / non-regular / unreadable → structural. */
function collectSkillMdPaths(root: string, structural: string[]): string[] {
    const skillsRoot = path.join(root, 'skills');
    const out: string[] = [];
    if (!fs.existsSync(skillsRoot)) return out;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    } catch (e) {
        structural.push(
            `Cannot read skills/: ${e instanceof Error ? e.message : String(e)}`,
        );
        return out;
    }
    for (const entry of entries) {
        const skillDir = path.join(skillsRoot, entry.name);
        const relDir = path.relative(root, skillDir);
        let dirStat: fs.Stats;
        try {
            dirStat = fs.lstatSync(skillDir);
        } catch (e) {
            structural.push(
                `Cannot inspect skill path ${relDir}: ${e instanceof Error ? e.message : String(e)}`,
            );
            continue;
        }
        if (dirStat.isSymbolicLink()) {
            structural.push(`Skill path ${relDir} must not be a symbolic link (fail closed)`);
            continue;
        }
        if (!dirStat.isDirectory()) {
            // Scaffold tracks empty skills/ with .gitkeep so git clone keeps the
            // content dir (RF-4.1). Other loose files remain structural.
            if (entry.name === '.gitkeep' && dirStat.isFile()) continue;
            structural.push(`Skill path ${relDir} must be a regular directory (fail closed)`);
            continue;
        }
        const skillMd = path.join(skillDir, 'SKILL.md');
        const relMd = path.relative(root, skillMd);
        let mdStat: fs.Stats;
        try {
            mdStat = fs.lstatSync(skillMd);
        } catch (error) {
            if (isMissing(error)) continue;
            structural.push(
                `Cannot inspect ${relMd}: ${error instanceof Error ? error.message : String(error)}`,
            );
            continue;
        }
        if (mdStat.isSymbolicLink()) {
            structural.push(`${relMd} must not be a symbolic link (fail closed)`);
            continue;
        }
        if (!mdStat.isFile()) {
            structural.push(`${relMd} must be a regular file (fail closed)`);
            continue;
        }
        try {
            fs.accessSync(skillMd, fs.constants.R_OK);
        } catch (e) {
            structural.push(
                `Unreadable ${relMd}: ${e instanceof Error ? e.message : String(e)} (fail closed)`,
            );
            continue;
        }
        out.push(skillMd);
    }
    return out;
}

/**
 * RF-4.5: store files under the registry tree are structural.
 * Symlink entries named `environments`, or basename `values.json`/`meta.json`, are structural
 * even when the walk does not follow the link.
 */
function scanEnvStoreInTree(root: string, structural: string[]): void {
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
            const rel = path.relative(root, abs);
            let stat: fs.Stats;
            try {
                stat = fs.lstatSync(abs);
            } catch {
                continue;
            }
            if (stat.isSymbolicLink()) {
                if (entry.name === 'environments' || STORE_BASENAMES.has(entry.name)) {
                    structural.push(
                        `Environment store symlink must not live in the registry tree: ${rel} (RF-4.5)`,
                    );
                }
                continue;
            }
            if (stat.isDirectory()) {
                stack.push(abs);
                continue;
            }
            if (stat.isFile()) {
                const parts = rel.split(/[/\\]/);
                if (parts.includes('environments') && STORE_BASENAMES.has(entry.name)) {
                    structural.push(
                        `Environment store file must not live in the registry tree: ${rel} (RF-4.5)`,
                    );
                }
            }
        }
    }
}

function scanProsePathHints(root: string, advisories: string[]): void {
    const skillsRoot = path.join(root, 'skills');
    if (!fs.existsSync(skillsRoot)) return;
    walkRegularFiles(skillsRoot, (abs, rel) => {
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

    if (typeof root !== 'string' || root.trim() === '') {
        return {
            structural: ['Registry root must be a non-empty string'],
            advisories,
        };
    }

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
    try {
        const factsStat = fs.lstatSync(factsPath);
        factsPresent = true;
        if (factsStat.isSymbolicLink()) {
            structural.push('facts.json must not be a symbolic link (regular-file guard)');
        } else if (!factsStat.isFile()) {
            structural.push('facts.json must be a regular file');
        } else {
            try {
                catalog = parseFactsCatalog(factsPath);
            } catch (e) {
                structural.push(`facts.json invalid: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    } catch (error) {
        if (!isMissing(error)) {
            structural.push(
                `Cannot inspect facts.json: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    const skillPaths = collectSkillMdPaths(resolvedRoot, structural);
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
            const reason = factsPresent
                ? 'facts.json is invalid/unreadable'
                : 'facts.json is missing';
            structural.push(
                `Skill ${path.relative(resolvedRoot, skillMd)} declares needs but ${reason} (fail closed)`,
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
