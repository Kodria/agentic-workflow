// cli/src/commands/registry/scaffold.ts
// Logic for `awm registry scaffold`, separated from commander wiring.
import fs from 'fs';
import path from 'path';
import { FACTS_MIN_CLI_VERSION } from '../../core/facts/types';

export type ScaffoldResult =
    | { ok: true; dir: string }
    | { ok: false; error: string };

export interface ScaffoldOptions {
    /**
     * Test seam for mid-fail / atomic cleanup (RF-4.3).
     * Defaults to `fs.writeFileSync`.
     */
    writeFileSync?: (file: string, data: string | NodeJS.ArrayBufferView) => void;
}

function writeJson(
    write: NonNullable<ScaffoldOptions['writeFileSync']>,
    file: string,
    value: unknown,
): void {
    write(file, JSON.stringify(value, null, 2) + '\n');
}

function handbookFor(name: string): string {
    return `# ${name}

## Capabilities
| id | status | notes |
|----|--------|-------|
| facts | active | see ## Capability: facts |

## Capability: facts

Declare operator/machine facts in \`facts.json\`. Skills may list \`needs\` in
frontmatter; values live in the machine-local environment store
(\`AWM_HOME/environments/\`), never in this registry tree.

- Add fact definitions under \`facts\` in \`facts.json\` (\`schemaVersion: 1\`).
- Keep \`minCliVersion\` in \`awm-registry.json\` at or above the CLI version that
  understands facts.
- Run \`awm registry doctor\` before publishing — structural failures block; advisories do not.
`;
}

function writeScaffoldTree(
    root: string,
    name: string,
    write: NonNullable<ScaffoldOptions['writeFileSync']>,
): void {
    writeJson(write, path.join(root, 'awm-registry.json'), {
        overrides: [],
        minCliVersion: FACTS_MIN_CLI_VERSION,
    });
    writeJson(write, path.join(root, 'catalog.json'), {
        version: 1,
        bundles: [],
    });

    const skillsDir = path.join(root, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    // Track skills/ in git — an empty dir is dropped on clone and then
    // validateRegistryLayout / awm registry add reject the tree (RF-4.1).
    write(path.join(skillsDir, '.gitkeep'), '');

    writeJson(write, path.join(root, 'facts.json'), {
        schemaVersion: 1,
        facts: {},
    });
    write(path.join(root, 'REGISTRY.md'), handbookFor(name));
}

/**
 * Create a minimal registry tree that passes structural `doctorRegistry`.
 * Atomic (RF-4.3): write into a temp sibling, then rename into place; on
 * failure remove only the staging dir so an empty preexisting target stays
 * empty (retryable) and a missing target stays absent.
 */
export function scaffoldRegistry(dir: string, opts: ScaffoldOptions = {}): ScaffoldResult {
    if (typeof dir !== 'string' || dir.trim() === '') {
        return { ok: false, error: 'scaffold target directory is required' };
    }

    const abs = path.resolve(dir);
    const write = opts.writeFileSync ?? ((file, data) => fs.writeFileSync(file, data));

    let targetExistsEmpty = false;
    if (fs.existsSync(abs)) {
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(abs);
        } catch (e) {
            return {
                ok: false,
                error: `Cannot inspect target ${abs}: ${e instanceof Error ? e.message : String(e)}`,
            };
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            return { ok: false, error: `Target exists and is not a directory: ${abs}` };
        }
        if (fs.readdirSync(abs).length > 0) {
            return {
                ok: false,
                error: `Target directory is not empty — refuse to overwrite: ${abs}`,
            };
        }
        targetExistsEmpty = true;
    }

    const parent = path.dirname(abs);
    let staging: string | undefined;
    try {
        fs.mkdirSync(parent, { recursive: true });
        staging = fs.mkdtempSync(path.join(parent, '.awm-scaffold-'));
        const name = path.basename(abs) || 'registry';
        writeScaffoldTree(staging, name, write);

        if (targetExistsEmpty) {
            // Drop the empty shell so rename can place staging at abs atomically.
            fs.rmdirSync(abs);
        }
        fs.renameSync(staging, abs);
        staging = undefined;
        return { ok: true, dir: abs };
    } catch (e) {
        if (staging) {
            try {
                fs.rmSync(staging, { recursive: true, force: true });
            } catch {
                // best-effort cleanup; surface the original write error
            }
        }
        return {
            ok: false,
            error: `Scaffold failed: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}
