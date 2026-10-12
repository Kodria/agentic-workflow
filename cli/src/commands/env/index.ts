import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
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
import { statusFor } from '../../core/environments/resolve';

export interface EnvCommandDeps {
    /** Load merged/explicit facts catalog for validation. Tests inject a fixed catalog. */
    loadCatalog?: () => FactsCatalog;
    /** Roots listed when an unknown fact id is rejected. */
    consultedRoots?: () => string[];
    /** Clock for status display. */
    now?: () => Date;
}

function loadCatalogFromInstalledRoots(): FactsCatalog {
    const merged: FactsCatalog = { schemaVersion: 1, facts: {} };
    for (const root of contentRoots()) {
        const factsPath = path.join(root, 'facts.json');
        if (!fs.existsSync(factsPath)) continue;
        const catalog = parseFactsCatalog(factsPath);
        Object.assign(merged.facts, catalog.facts);
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
        .action((factId: string, opts: { value?: string }) => {
            const value = requireValue(opts.value, 'awm env set');
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
        .option('--all', 'refresh every fact present in the store (each needs --value? not supported; pass factId)')
        .action((factId: string | undefined, opts: { value?: string; all?: boolean }) => {
            if (opts.all && !factId) {
                throw new EnvironmentStoreError(
                    'awm env refresh --all requires interactive prompts in v1; pass <factId> with --value in tests/non-interactive',
                );
            }
            if (!factId) {
                throw new EnvironmentStoreError('awm env refresh requires <factId> (or interactive --all)');
            }
            const value = requireValue(opts.value, 'awm env refresh');
            setFact(factId, value, { loadCatalog, consultedRoots });
            process.stdout.write(`Refreshed ${factId} in environment ${getActiveEnvironmentName()}\n`);
        });

    env.command('use <name>')
        .description('switch the active environment (one active per machine)')
        .action((name: string) => {
            setActiveEnvironmentName(name);
            process.stdout.write(`Active environment: ${name}\n`);
        });
}
