/** Generates the sensor-pack evidence block in docs/support-matrix.md.
 *
 * The registry owns pack definitions. This renderer is intentionally a consumer of
 * those manifests instead of a second hand-written list of tools or versions.
 */
import fs from 'fs';
import path from 'path';
import { parseSensorPack } from '../src/commands/sensors/compatibility/contract';
import type { ParsedSensorPack } from '../src/commands/sensors/compatibility/types';

export const SENSOR_BEGIN_MARKER = '<!-- BEGIN GENERATED: sensor-pack-support -->';
export const SENSOR_END_MARKER = '<!-- END GENERATED: sensor-pack-support -->';
export const SENSOR_PACKS = ['generic', 'js-ts', 'python', 'shell'] as const;
export const SENSOR_DOC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'support-matrix.md');
export const R3_PREPUBLICATION_FIXTURE_RELATIVE_PATH = 'tests/fixtures/sensor-support-matrix/registry';
/**
 * The CLI R3 contract is implemented before the baseline registry publishes its
 * v2 manifests. The generated matrix intentionally renders this pinned fixture,
 * never an invented description of an unpublished registry release.
 */
export const R3_PREPUBLICATION_FIXTURE_PURPOSE = 'R3 pre-publication contract fixture';

function registryPath(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
        throw new Error('sensor support matrix requires a non-empty --registry-root');
    }
    return path.resolve(value);
}

function packPath(registryRoot: string, name: string): string {
    if (!SENSOR_PACKS.includes(name as typeof SENSOR_PACKS[number])) throw new Error(`unsupported first-party pack: ${name}`);
    return path.join(registryRoot, 'sensor-packs', name, 'pack.json');
}

export function parseRegistrySensorPacks(registryRoot: unknown): Array<{ name: string; parsed: ParsedSensorPack }> {
    const root = registryPath(registryRoot);
    return SENSOR_PACKS.map((name) => {
        const file = packPath(root, name);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`sensor pack must be a regular file: ${file}`);
        let source: unknown;
        try { source = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
            throw new Error(`cannot parse sensor pack ${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { name, parsed: parseSensorPack(source, file) };
    });
}

function variants(pack: Extract<ParsedSensorPack, { kind: 'v2' }>['pack']): string {
    return Object.entries(pack.sensors).flatMap(([sensor, definition]) => definition.variants.map((variant) =>
        `\`${sensor}/${variant.id}\`: ${variant.requirements.tool} ${variant.requirements.toolRange}; ${variant.requirements.runtime} ${variant.requirements.runtimeRange}; certified ${variant.certifiedRange}`,
    )).join('<br>');
}

/** Pure renderer used by freshness tests and the documentation command. */
export function renderSensorSupportMatrix(registryRoot: unknown): string {
    const lines = [
        `### Sensor-pack compatibility contract (${R3_PREPUBLICATION_FIXTURE_PURPOSE})`,
        '',
        '| Pack | Contract | Version-aware variants and certified ranges | Evidence status |',
        '|---|---|---|---|',
    ];
    for (const { name, parsed } of parseRegistrySensorPacks(registryRoot)) {
        if (parsed.kind === 'legacy') {
            lines.push(`| \`${name}\` | legacy pack | No v2 variants declared | compatible-unverified — migrate the pack before claiming version certification |`);
        } else {
            lines.push(`| \`${name}\` | pack schema v2 | ${variants(parsed.pack)} | Fixture-declared ranges only; real-tool and OS certification awaits published registry release evidence |`);
        }
    }
    lines.push('');
    lines.push('> Generated from the pinned R3 pre-publication contract fixture, not the published `awm-baseline-registry` manifests. **Do not edit by hand** — `npm run docs:matrix` regenerates this block. T13 verifies the actual registry tag and release evidence.');
    return lines.join('\n');
}

export function spliceSensorSupportMatrix(markdown: string, generated: string): string {
    const begin = markdown.indexOf(SENSOR_BEGIN_MARKER);
    const end = markdown.indexOf(SENSOR_END_MARKER);
    if (begin === -1 || end === -1 || end < begin) throw new Error(`support-matrix.md lacks ${SENSOR_BEGIN_MARKER} / ${SENSOR_END_MARKER}`);
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    const block = generated.split('\n').join(eol);
    return markdown.slice(0, begin + SENSOR_BEGIN_MARKER.length) + eol + eol + block + eol + eol + markdown.slice(end);
}

export function registryRootFromArgs(argv: readonly string[]): string {
    const index = argv.indexOf('--registry-root');
    if (index === -1 || argv[index + 1] === undefined || argv[index + 1].startsWith('--') || index !== argv.lastIndexOf('--registry-root')) {
        throw new Error('sensor support matrix requires exactly one --registry-root <path>');
    }
    return registryPath(argv[index + 1]);
}

/* istanbul ignore next: command shell is covered through exported functions. */
if (require.main === module) {
    const root = registryRootFromArgs(process.argv.slice(2));
    const current = fs.readFileSync(SENSOR_DOC_PATH, 'utf8');
    fs.writeFileSync(SENSOR_DOC_PATH, spliceSensorSupportMatrix(current, renderSensorSupportMatrix(root)), 'utf8');
    process.stdout.write('support-matrix.md sensor-pack evidence regenerated from registry manifests\n');
}
