import fs from 'fs';
import path from 'path';

jest.mock('@clack/prompts', () => ({
    log: { error: jest.fn(), success: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { parseSensorManifest } from '../../src/commands/sensors/compatibility/manifest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

type DocumentedJson = { value: unknown; intentionallyIncomplete: boolean };

function documentedJson(files: readonly string[]): DocumentedJson[] {
    return files.flatMap((file) => {
        const source = read(file);
        return Array.from(source.matchAll(/```json\s*\n([\s\S]*?)```/g), (match) => {
            const sectionStart = source.lastIndexOf('###', match.index ?? 0);
            const leadIn = source.slice(Math.max(0, sectionStart), match.index ?? 0);
            return {
                value: JSON.parse(match[1]),
                intentionallyIncomplete: /intentionally incomplete fragment/.test(leadIn),
            };
        });
    });
}

function documentedV2Manifests(files: readonly string[]): Record<string, unknown>[] {
    return documentedJson(files)
        .filter((example): example is DocumentedJson & { value: Record<string, unknown> } =>
            !example.intentionallyIncomplete
            && typeof example.value === 'object'
            && example.value !== null
            && (example.value as Record<string, unknown>).schemaVersion === 2,
        )
        .map(example => example.value);
}

describe('R3 canonical sensor documentation', () => {
    test('parses every documented v2 sensor manifest example with the production parser', () => {
        const examples = documentedV2Manifests(['docs/configuration.md', 'docs/cli-reference.md']);
        expect(examples.length).toBeGreaterThan(0);
        examples.forEach((example) => expect(() => parseSensorManifest(example, 'documented example')).not.toThrow());
    });

    test('keeps documented v2 sensor manifests portable across native platforms', () => {
        const examples = documentedV2Manifests(['docs/configuration.md', 'docs/cli-reference.md']);
        expect(examples.length).toBeGreaterThan(0);
        examples.forEach((example) => expect(example).not.toHaveProperty('registryRoot'));
    });

    test('excludes only an explicitly incomplete timeout fragment, not invalid full v2 manifests', () => {
        const examples = documentedJson(['docs/configuration.md']);
        const incomplete = examples.find(example => example.intentionallyIncomplete);
        const complete = documentedV2Manifests(['docs/configuration.md']);

        expect(incomplete?.value).toMatchObject({ schemaVersion: 2, sensors: { test: { timeout: 600000 } } });
        expect(() => parseSensorManifest(incomplete?.value, 'incomplete timeout fragment')).toThrow();
        expect(complete).toHaveLength(1);
        expect(() => parseSensorManifest(complete[0], 'complete documented manifest')).not.toThrow();
        expect(() => parseSensorManifest({
            schemaVersion: 2, pack: 'js-ts', sensors: { test: { enabled: true, variantId: 'npm-script' } },
        }, 'invalid full manifest')).toThrow();
    });
});
