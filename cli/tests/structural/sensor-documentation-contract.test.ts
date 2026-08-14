import fs from 'fs';
import path from 'path';
import { Command } from 'commander';

jest.mock('@clack/prompts', () => ({
    log: { error: jest.fn(), success: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { parseSensorManifest } from '../../src/commands/sensors/compatibility/manifest';
import { registerLedgerCommand } from '../../src/commands/ledger';
import { registerSensorsCommand } from '../../src/commands/sensors';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

function documentedJson(files: readonly string[]): unknown[] {
    return files.flatMap((file) => Array.from(read(file).matchAll(/```json\s*\n([\s\S]*?)```/g), (match) => JSON.parse(match[1])));
}

function helpFor(command: 'sensors coverage' | 'ledger add'): string {
    const program = new Command().name('awm');
    registerSensorsCommand(program);
    registerLedgerCommand(program);
    const [parent, child] = command.split(' ');
    return program.commands.find((entry) => entry.name() === parent)!
        .commands.find((entry) => entry.name() === child)!.helpInformation();
}

describe('R3 canonical sensor documentation', () => {
    test.each([
        ['docs/framework.md', ['Static coverage', 'Empirical coverage', 'retrospective feedback loop']],
        ['docs/configuration.md', ['pack schema v2', 'legacy pack', 'compatible-unverified']],
        ['docs/project-setup.md', ['version-aware', 'hardening opt-in']],
        ['docs/runbook.md', ['awm sensors coverage --min', 'compatibility drift', 'orphaned asset']],
        ['docs/cli-reference.md', ['schemaVersion: 2', '--defect-class', '--min']],
        ['docs/architecture.md', ['compatibility resolver', 'bounded probe']],
    ] as const)('%s owns its R3 subject', (file, phrases) => {
        const text = read(file);
        phrases.forEach((phrase) => expect(text).toContain(phrase));
    });

    test('parses every documented v2 sensor manifest example with the production parser', () => {
        const examples = documentedJson(['docs/configuration.md', 'docs/cli-reference.md'])
            .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && (value as Record<string, unknown>).schemaVersion === 2);
        expect(examples.length).toBeGreaterThan(0);
        examples.forEach((example) => expect(() => parseSensorManifest(example, 'documented example')).not.toThrow());
    });

    test('keeps documented v2 sensor manifests portable across native platforms', () => {
        const examples = documentedJson(['docs/configuration.md', 'docs/cli-reference.md'])
            .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && (value as Record<string, unknown>).schemaVersion === 2);
        expect(examples.length).toBeGreaterThan(0);
        examples.forEach((example) => expect(example).not.toHaveProperty('registryRoot'));
    });

    test('documents exact Commander flags', () => {
        expect(helpFor('sensors coverage')).toContain('--min <count>');
        expect(helpFor('ledger add')).toContain('--defect-class <id>');
        const reference = read('docs/cli-reference.md');
        expect(reference).toContain('awm sensors coverage [--json] [--min <count>]');
        expect(reference).toContain('--defect-class <id>');
    });

    test('does not overstate the human coverage renderer or retrospective archive wiring', () => {
        const reference = read('docs/cli-reference.md');
        const runbook = read('docs/runbook.md');

        expect(reference).toMatch(/safe,\s+sanitized evidence references and safe cluster signatures/);
        expect(reference).toMatch(/never ledger\s+descriptions, raw ledger lines, or unsafe values/);
        expect(runbook).toContain('Run `awm sensors coverage --min 2` manually before archive');
        expect(runbook).toMatch(/Automatic\s+coverage-before-archive enforcement is delivered by the registry in T12/);
        expect(runbook).not.toContain('it automatically evaluates\ncoverage feedback');
    });

    test('keeps archival coverage manual until registry enforcement and scopes v2 binary resolution', () => {
        const framework = read('docs/framework.md');
        const osMatrix = read('docs/testing/os-matrix.md');

        expect(framework).toMatch(/manual operator step[\s\S]*until the registry delivers automatic enforcement in T12/i);
        expect(osMatrix).toMatch(/v2 local resolution modes use project-local `node_modules` or `.venv`\/`venv`\s+environments/i);
        expect(osMatrix).toMatch(/Windows `.cmd`\/`.bat` wrappers are rejected for structured v2\s+commands/i);
        expect(osMatrix).toMatch(/Legacy string\s+commands remain separate and retain their documented shell\/PATH semantics/i);
        expect(osMatrix).not.toContain('Sensors resolve their binaries on PATH');
    });
});
