import fs from 'fs';
import path from 'path';
import { parseSensorManifest } from '../../src/commands/sensors/compatibility/manifest';
import type { ProjectDeclaredSensor } from '../../src/commands/sensors/compatibility/manifest';

/**
 * RF-4.1 mechanical gate (M1): do not prose-grep the docs. Extract the documented
 * project-sensor JSON example under the test-results section and assert the real
 * parser accepts `resultsFile`. Stripping that field from the docs example must
 * make extraction refuse (docs contract kill).
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

/** Strip `"resultsFile": "..."` from JSON text and repair trailing commas. */
function stripResultsFileProperty(jsonText: string): string {
    return jsonText
        .replace(/,?\s*"resultsFile"\s*:\s*"[^"]*"\s*/g, '')
        .replace(/,\s*([}\]])/g, '$1');
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

    it('refuses extraction when resultsFile is stripped from the documented example (docs contract kill)', () => {
        const markdown = fs.readFileSync(DOC, 'utf8');
        const raw = extractTestResultsExample(markdown);
        expect(raw).toMatch(/"resultsFile"\s*:/);

        const stripped = stripResultsFileProperty(raw);
        expect(stripped).not.toMatch(/"resultsFile"\s*:/);
        expect(markdown).toContain(raw);

        // Replace the live docs example body once. Extractor must then refuse —
        // weakening it to accept any fence without resultsFile fails this kill.
        const poisoned = markdown.replace(raw, stripped);
        expect(() => extractTestResultsExample(poisoned)).toThrow(
            /no fenced example that includes resultsFile/,
        );

        // Accept boundary: stripped JSON still parses as a project sensor, just
        // without resultsFile (optional field) — kill is the extractor, not JSON.
        const parsed = parseSensorManifest(JSON.parse(stripped), 'docs/cli-reference.md#stripped');
        expect(parsed.kind).toBe('v3');
        if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') {
            throw new Error('expected v3 project-sensors example');
        }
        expect((parsed.pack.sensors.test as ProjectDeclaredSensor).resultsFile).toBeUndefined();
    });
});
