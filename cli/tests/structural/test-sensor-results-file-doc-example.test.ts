import fs from 'fs';
import path from 'path';
import { parseSensorManifest } from '../../src/commands/sensors/compatibility/manifest';
import type { ProjectDeclaredSensor } from '../../src/commands/sensors/compatibility/manifest';

/**
 * RF-4.1 mechanical gate (M1): do not prose-grep the docs. Extract the documented
 * project-sensor JSON example under the test-results section and assert the real
 * parser accepts `resultsFile`. Deleting that field from the example must fail.
 */
const ROOT = path.resolve(__dirname, '../../..');
const DOC = path.join(ROOT, 'docs/cli-reference.md');

function extractTestResultsExample(markdown: string): string {
    const sectionMatch = markdown.match(
        /#{2,4}\s+[^\n]*(?:test[- ]results|resultsFile|test sensor findings)[^\n]*\n([\s\S]*?)(?=\n#{2,3}\s+|$)/i,
    );
    if (!sectionMatch) {
        throw new Error('docs/cli-reference.md has no test-results / resultsFile section heading');
    }
    const section = sectionMatch[1];
    const fences = [...section.matchAll(/```(?:json|yaml|yml)?\n([\s\S]*?)```/g)];
    const withResultsFile = fences.find((fence) => /\bresultsFile\b/.test(fence[1]));
    if (!withResultsFile) {
        throw new Error('test-results section has no fenced example that includes resultsFile');
    }
    return withResultsFile[1].trim();
}

describe('documented test-sensor resultsFile example (RF-4.1)', () => {
    it('extracts a parseable project-sensor example that accepts resultsFile', () => {
        const markdown = fs.readFileSync(DOC, 'utf8');
        const raw = extractTestResultsExample(markdown);
        const example = JSON.parse(raw) as unknown;

        const parsed = parseSensorManifest(example, 'docs/cli-reference.md#test-results');
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') {
            throw new Error('expected v3 project-sensors example');
        }
        const testSensor = parsed.pack.sensors.test as ProjectDeclaredSensor | undefined;
        expect(testSensor).toBeDefined();
        expect(testSensor?.resultsFile).toEqual(expect.any(String));
        expect(testSensor!.resultsFile!.length).toBeGreaterThan(0);
    });

    it('fails when resultsFile is deleted from the documented example', () => {
        const markdown = fs.readFileSync(DOC, 'utf8');
        const raw = extractTestResultsExample(markdown);
        const example = JSON.parse(raw) as Record<string, unknown>;
        const sensors = example.sensors as Record<string, Record<string, unknown>>;
        expect(sensors.test).toBeDefined();
        delete sensors.test.resultsFile;

        const parsed = parseSensorManifest(example, 'docs/cli-reference.md#mutated');
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') {
            throw new Error('expected v3 project-sensors example');
        }
        const testSensor = parsed.pack.sensors.test as ProjectDeclaredSensor;
        expect(testSensor.resultsFile).toBeUndefined();
    });
});
