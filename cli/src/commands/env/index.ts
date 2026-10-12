import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { parseFactsCatalog } from '../../core/facts/catalog';
import type { FactsCatalog } from '../../core/facts/types';
import { contentRoots } from '../../core/registries';
import {
    EnvironmentStoreError,
    getActiveEnvironmentName,
    readValues,
    setActiveEnvironmentName,
    valuesPath,
    writeFact,
} from '../../core/environments/store';
import { buildInjection, statusFor } from '../../core/environments/resolve';

export interface EnvCommandDeps {
    /** Load merged/explicit facts catalog for validation. Tests inject a fixed catalog. */
    loadCatalog?: () => FactsCatalog;
    /** Roots listed when an unknown fact id is rejected. */
    consultedRoots?: () => string[];
    /** Clock for status display. */
    now?: () => Date;
    /** Whether stdin is a TTY (interactive prompts). Defaults to `process.stdin.isTTY`. */
    stdinIsTTY?: () => boolean;
    /** Prompt for a missing --value. Defaults to readline question on stdin. */
    promptValue?: (question: string) => string | Promise<string>;
}

/**
 * Merge facts catalogs from installed registry roots.
 * Later roots may refine a fact, but must not weaken durability: volatile wins
 * over durable so an expired secret cannot be revived by a durable override.
 */
export function mergeFactDefinitions(
    into: FactsCatalog['facts'],
    from: FactsCatalog['facts'],
): void {
    for (const [id, next] of Object.entries(from)) {
        const prev = Object.hasOwn(into, id) ? into[id] : undefined;
        if (!prev) {
            into[id] = next;
            continue;
        }
        if (prev.durability === 'volatile' && next.durability === 'durable') {
            const kept = { ...next, durability: 'volatile' as const };
            if (prev.ttl !== undefined) kept.ttl = prev.ttl;
            into[id] = kept;
            continue;
        }
        into[id] = next;
    }
}

function loadCatalogFromInstalledRoots(): FactsCatalog {
    const merged: FactsCatalog = { schemaVersion: 1, facts: {} };
    for (const root of contentRoots()) {
        const factsPath = path.join(root, 'facts.json');
        if (!fs.existsSync(factsPath)) continue;
        const catalog = parseFactsCatalog(factsPath);
        mergeFactDefinitions(merged.facts, catalog.facts);
    }
    return merged;
}

function defaultConsultedRoots(): string[] {
    return contentRoots();
}

function requireValue(value: string | undefined, flagHint: string): string {
    if (value === undefined) {
        throw new EnvironmentStoreError(
            `${flagHint} requires --value <text> in non-interactive mode (prompt / editable store / --value only; RF-3.3)`,
        );
    }
    return value;
}

async function defaultPromptValue(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return await new Promise<string>((resolve) => {
            rl.question(question, (answer) => resolve(answer));
        });
    } finally {
        rl.close();
    }
}

async function resolveValue(
    optsValue: string | undefined,
    flagHint: string,
    factId: string,
    deps: {
        stdinIsTTY: () => boolean;
        promptValue: (question: string) => string | Promise<string>;
    },
): Promise<string> {
    if (optsValue !== undefined) return optsValue;
    if (!deps.stdinIsTTY()) {
        return requireValue(undefined, flagHint);
    }
    return Promise.resolve(deps.promptValue(`Value for ${factId}: `));
}

function setFact(
    factId: string,
    rawValue: string,
    deps: Required<Pick<EnvCommandDeps, 'loadCatalog' | 'consultedRoots'>>,
): void {
    const catalog = deps.loadCatalog();
    const name = getActiveEnvironmentName();
    writeFact(
        name,
        factId,
        {
            value: rawValue,
            status: 'fresh',
            updatedAt: new Date().toISOString(),
        },
        {
            catalog,
            consultedRoots: deps.consultedRoots(),
        },
    );
}

export function registerEnvCommand(program: Command, deps: EnvCommandDeps = {}): void {
    const loadCatalog = deps.loadCatalog ?? loadCatalogFromInstalledRoots;
    const consultedRoots = deps.consultedRoots ?? defaultConsultedRoots;
    const now = deps.now ?? (() => new Date());
    const stdinIsTTY = deps.stdinIsTTY ?? (() => Boolean(process.stdin.isTTY));
    const promptValue = deps.promptValue ?? defaultPromptValue;

    const env = program.command('env').description('manage machine-local operator environments (facts store)');

    env.command('status')
        .description('show active environment and fact statuses vs catalog')
        .action(() => {
            const name = getActiveEnvironmentName();
            const catalog = loadCatalog();
            const store = readValues(name);
            const statuses = statusFor(catalog, store, now());
            const lines: string[] = [
                `Active environment: ${name}`,
                `Store: ${valuesPath(name)}`,
                '',
                'Facts:',
            ];
            const ids = Object.keys(catalog.facts).sort();
            if (ids.length === 0) {
                lines.push('  (no facts in consulted catalogs)');
            } else {
                for (const id of ids) {
                    lines.push(`  ${id}: ${statuses[id]}`);
                }
            }
            process.stdout.write(lines.join('\n') + '\n');
        });

    env.command('set <factId>')
        .description('set a fact value in the active environment (--value for non-interactive)')
        .option('--value <text>', 'fact value (required non-interactive; never runs registry commands)')
        .action(async (factId: string, opts: { value?: string }) => {
            const value = await resolveValue(opts.value, 'awm env set', factId, {
                stdinIsTTY,
                promptValue,
            });
            setFact(factId, value, { loadCatalog, consultedRoots });
            process.stdout.write(`Set ${factId} in environment ${getActiveEnvironmentName()}\n`);
        });

    env.command('edit')
        .description('print the absolute path of the active environment values.json')
        .action(() => {
            const name = getActiveEnvironmentName();
            const file = valuesPath(name);
            process.stdout.write(`${file}\n`);
        });

    env.command('refresh [factId]')
        .description('re-set a fact value (prompt / --value only; no registry commands)')
        .option('--value <text>', 'new value (required non-interactive)')
        .option('--all', 'refresh every fact present in the store (interactive prompts, or pass factId)')
        .action(async (factId: string | undefined, opts: { value?: string; all?: boolean }) => {
            if (opts.all && !factId) {
                if (!stdinIsTTY()) {
                    throw new EnvironmentStoreError(
                        'awm env refresh --all requires a TTY (or pass <factId> with --value in non-interactive mode)',
                    );
                }
                const name = getActiveEnvironmentName();
                const ids = Object.keys(readValues(name));
                if (ids.length === 0) {
                    throw new EnvironmentStoreError('awm env refresh --all: active store has no facts');
                }
                for (const id of ids) {
                    const value = await Promise.resolve(promptValue(`Value for ${id}: `));
                    setFact(id, value, { loadCatalog, consultedRoots });
                    process.stdout.write(`Refreshed ${id} in environment ${getActiveEnvironmentName()}\n`);
                }
                return;
            }
            if (!factId) {
                throw new EnvironmentStoreError('awm env refresh requires <factId> (or interactive --all)');
            }
            const value = await resolveValue(opts.value, 'awm env refresh', factId, {
                stdinIsTTY,
                promptValue,
            });
            setFact(factId, value, { loadCatalog, consultedRoots });
            process.stdout.write(`Refreshed ${factId} in environment ${getActiveEnvironmentName()}\n`);
        });

    env.command('use <name>')
        .description('switch the active environment (one active per machine)')
        .action((name: string) => {
            setActiveEnvironmentName(name);
            process.stdout.write(`Active environment: ${name}\n`);
        });

    env.command('inject')
        .description('print JSON injection payload for the active environment (default mode: reference)')
        .option('--mode <mode>', 'injection mode: reference|context', 'reference')
        .action((opts: { mode?: string }) => {
            const rawMode = opts.mode ?? 'reference';
            const mode: 'reference' | 'context' =
                rawMode === 'reference' || rawMode === 'context' ? rawMode : 'reference';
            const name = getActiveEnvironmentName();
            const catalog = loadCatalog();
            const store = readValues(name);
            const result = buildInjection({
                catalog,
                store,
                storePath: valuesPath(name),
                inject: mode,
                now: now(),
            });
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        });
}
