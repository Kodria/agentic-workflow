import fs from 'fs';
import os from 'os';
import path from 'path';
import { preflight, type PreflightReport } from '../../../src/commands/preflight/checks';
import { exitCodeFor, formatReport } from '../../../src/commands/preflight';

/**
 * RF-3.4 — preflight surfaces a non-blocking (advisory) warning when configured
 * enabled sensors lack effective `inputs`. Opt-out / native-gate must stay quiet.
 */
describe('preflight sensors-inputs warning (RF-3.4)', () => {
    const dirs: string[] = [];
    const homes: string[] = [];
    let previousHome: string | undefined;

    beforeEach(() => {
        previousHome = process.env.AWM_HOME;
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pf-inputs-home-'));
        homes.push(home);
        process.env.AWM_HOME = home;
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([]));
    });

    afterEach(() => {
        if (previousHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = previousHome;
    });

    afterAll(() => {
        for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
        for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
    });

    function project(opts: {
        context?: string[];
        manifest?: unknown;
        bins?: string[];
    } = {}): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pf-inputs-'));
        dirs.push(dir);
        for (const f of opts.context ?? ['AGENTS.md']) {
            fs.writeFileSync(path.join(dir, f), '# ctx\n');
        }
        for (const b of opts.bins ?? ['eslint']) {
            fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'node_modules', '.bin', b), '');
        }
        if (opts.manifest !== undefined) {
            fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
            fs.writeFileSync(
                path.join(dir, '.awm', 'sensors.json'),
                typeof opts.manifest === 'string' ? opts.manifest : JSON.stringify(opts.manifest),
            );
        }
        return dir;
    }

    function check(report: PreflightReport, id: string) {
        return report.checks.find(c => c.id === id);
    }

    function onlyProjectSensor(extra: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            schemaVersion: 3,
            mode: 'project-sensors',
            sensors: {
                custom: {
                    source: 'project',
                    enabled: true,
                    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                    formatter: 'exit-code',
                    ...extra,
                },
            },
        };
    }

    it('emits an advisory sensors-inputs warning when an enabled sensor lacks inputs', async () => {
        const dir = project({ manifest: onlyProjectSensor() });

        const report = await preflight(dir);

        expect(report.status).toBe('ready');
        expect(exitCodeFor(report)).toBe(0);
        expect(check(report, 'sensors-inputs')).toMatchObject({
            ok: false,
            advisory: true,
            detail: expect.stringMatching(/custom/i),
            remedy: expect.stringMatching(/inputs|cache/i),
        });
        expect(check(report, 'sensors-inputs')!.detail).toMatch(/not cacheable|no effective inputs|lacks inputs/i);
        expect(formatReport(report)).toMatch(/⚠.*sensors-inputs/s);
    });

    it('omits sensors-inputs when every enabled sensor has effective inputs', async () => {
        const dir = project({ manifest: onlyProjectSensor({ inputs: ['**/*.ts'] }) });

        const report = await preflight(dir);

        expect(report.status).toBe('ready');
        expect(check(report, 'sensors-inputs')).toBeUndefined();
    });

    it('does not warn for disabled sensors that lack inputs', async () => {
        const dir = project({
            manifest: onlyProjectSensor({ enabled: false }),
        });

        const report = await preflight(dir);

        expect(check(report, 'sensors-inputs')).toBeUndefined();
    });

    it.each([
        ['native-gate', 'CI is authoritative.', 'native_gate'],
        ['opt-out', 'No local gate.', 'ungated'],
    ] as const)('emits no sensors-inputs warning for v3 %s', async (mode, reason, status) => {
        const dir = project({
            manifest: { schemaVersion: 3, mode, reason },
        });

        const report = await preflight(dir);

        expect(report.status).toBe(status);
        expect(check(report, 'sensors-inputs')).toBeUndefined();
    });
});
