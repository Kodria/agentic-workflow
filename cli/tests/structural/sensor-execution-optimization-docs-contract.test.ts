import fs from 'fs';
import path from 'path';

/**
 * CMD-CLI-DOCS — RF-3.3 sensor execution optimization CLI reference.
 *
 * Section-scoped asserts only: a whole-file keyword must not satisfy these.
 * No registry file reads (CLI plan S5).
 */

const repoRoot = path.resolve(__dirname, '../../..');
const cliReferencePath = path.join(repoRoot, 'docs', 'cli-reference.md');

function readCliReference(): string {
    return fs.readFileSync(cliReferencePath, 'utf8');
}

/** H2 Sensors block through the next H2. */
function sensorsSection(text: string): string {
    const start = text.indexOf('## Sensors (per-project computational checks)');
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const nextH2 = rest.search(/\n## (?!Sensors)/);
    return nextH2 === -1 ? rest : rest.slice(0, nextH2);
}

/** Named H3 inside a parent section; fails if the heading is absent. */
function h3Section(parent: string, heading: string): string {
    const start = parent.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = parent.slice(start);
    const next = rest.search(/\n### /);
    return next === -1 ? rest : rest.slice(0, next);
}

/** Named H4 inside a parent section; fails if the heading is absent. */
function h4Section(parent: string, heading: string): string {
    const start = parent.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = parent.slice(start);
    const next = rest.search(/\n#### /);
    return next === -1 ? rest : rest.slice(0, next);
}

describe('sensor execution optimization docs contract (CMD-CLI-DOCS / RF-3.3)', () => {
    it('documents authored inputs and sensor-level closureOnly under Sensors', () => {
        const sensors = sensorsSection(readCliReference());
        const section = h3Section(sensors, '### Inputs and closureOnly');

        expect(section).toMatch(/`inputs`/);
        expect(section).toMatch(/variant|project override|pack/i);
        expect(section).toMatch(/no effective `inputs`[\s\S]{0,160}always execute|always execute[\s\S]{0,160}no effective `inputs`/i);
        expect(section).toMatch(/`closureOnly`/);
        expect(section).toMatch(/sensor-level|sensor object/i);
        expect(section).toMatch(/mutation[\s\S]{0,120}closureOnly|closureOnly[\s\S]{0,120}mutation/i);
    });

    it('documents --slice and --no-cache on awm sensors run', () => {
        const sensors = sensorsSection(readCliReference());
        const run = h3Section(sensors, '### `awm sensors run`');

        expect(run).toMatch(/--slice/);
        expect(run).toMatch(/closureOnly/);
        expect(run).toMatch(/--slice[\s\S]{0,200}(?:reject|refuse|not combine|cannot(?:\s+be)?\s+combin)[\s\S]{0,80}--(?:all|slow)|(?:--all|--slow)[\s\S]{0,120}(?:reject|refuse|not combine|cannot(?:\s+be)?\s+combin)[\s\S]{0,80}--slice/i);
        expect(run).toMatch(/--no-cache/);
        expect(run).toMatch(/isFullSelection|full[- ]gate|Change Record receipt/i);
        expect(run).toMatch(/--slice[\s\S]{0,200}(?:not|never|no)[\s\S]{0,80}receipt|receipt[\s\S]{0,120}--slice/i);
    });

    it('documents cache hit semantics, provenance, fingerprint, and failureKind', () => {
        const sensors = sensorsSection(readCliReference());
        const cache = h4Section(
            h3Section(sensors, '### `awm sensors run`'),
            '#### Result cache',
        );

        expect(cache).toMatch(/cache hit|cached:\s*`?true`?/i);
        expect(cache).toMatch(/originDirty/);
        expect(cache).toMatch(/fingerprint|sensorFingerprint/i);
        expect(cache).toMatch(/always-measured|alwaysMeasured/i);
        expect(cache).toMatch(/live[\s\S]{0,80}version|liveState/i);
        expect(cache).toMatch(/failureKind/);
        expect(cache).toMatch(/findings/);
        expect(cache).toMatch(/missing-binary|exit-code/);
        expect(cache).toMatch(/\.awm\/sensors\/runs\//);
        expect(cache).toMatch(/pre-baseline|before baseline|raw[\s\S]{0,40}baseline/i);
        expect(cache).toMatch(/--changed[\s\S]{0,160}(?:not|never|must not)[\s\S]{0,80}(?:write|cache)|(?:write|cache)[\s\S]{0,120}(?:not|never)[\s\S]{0,80}--changed/i);
    });

    it('documents receipt schema 2 and RF-4.6 Change Record honesty', () => {
        const sensors = sensorsSection(readCliReference());
        const receipt = h4Section(
            h3Section(sensors, '### `awm sensors run`'),
            '#### Sensor receipt',
        );

        expect(receipt).toMatch(/"schema"\s*:\s*2|schema\s*`?2`?/);
        expect(receipt).toMatch(/measurements/);
        expect(receipt).toMatch(/alwaysMeasuredPaths|always-measured/i);
        // RF-4.6 honesty only — "legacy late-path rules" elsewhere must not satisfy this.
        expect(receipt).toMatch(
            /RF-4\.6[\s\S]{0,80}honesty[\s\S]{0,400}schema-1 late-path|schema-1 late-path[\s\S]{0,400}RF-4\.6[\s\S]{0,80}honesty/i,
        );
        expect(receipt).toMatch(
            /(?:any|every)[\s\S]{0,80}(?:without|no|lacks)[\s\S]{0,60}inputs[\s\S]{0,160}schema[\s\S]{0,40}1|schema[\s\S]{0,40}1[\s\S]{0,160}(?:without|no|lacks)[\s\S]{0,60}inputs/i,
        );
        expect(receipt).toMatch(/docs-only|documentation-only|docs only/i);
        expect(receipt).toMatch(/project override/i);
    });
});
