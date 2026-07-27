import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSensors } from '../../../src/commands/sensors/run';

/**
 * These tests deliberately do NOT mock `child_process`: the defect they pin only
 * exists against a real shell. On Debian/Ubuntu `/bin/sh` is dash, which writes
 * `not found` — not bash's `command not found` — so a string-matching heuristic
 * reads a missing binary as a benign skip. What is being fixed here is the
 * invariant "a tool that could not run is never green", NOT the wording of any
 * particular shell, so no assertion below matches shell text.
 *
 * The sensor is named `security` on purpose. Sensors with a structured formatter
 * (semgrep/tsc/eslint) return zero findings for unparseable shell noise and fall
 * through to the tool-missing branch; a sensor with the generic formatter turns
 * any stderr into a finding and never reaches it.
 */

const MISSING_BIN = 'awm-nonexistent-binary-xyz';

function mkProject(sensors: Record<string, unknown>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-tool-missing-'));
    fs.mkdirSync(path.join(root, '.awm'));
    fs.writeFileSync(
        path.join(root, '.awm', 'sensors.json'),
        JSON.stringify({ pack: 'js-ts', sensors }),
    );
    return root;
}

describe('runSensors — an absent tool never reads as green (real /bin/sh)', () => {
    const roots: string[] = [];
    afterAll(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

    const project = (sensors: Record<string, unknown>) => {
        const root = mkProject(sensors);
        roots.push(root);
        return root;
    };

    it('marks a sensor whose binary is absent as fail, not skipped', () => {
        const root = project({ security: { cmd: `${MISSING_BIN} .`, fast: true } });

        const out = runSensors({ cwd: root });

        const security = out.sensors.find(s => s.name === 'security');
        expect(security!.status).toBe('fail');
        expect(security!.errors[0].message).toMatch(/not available/i);
    });

    it('does not let a healthy sensor carry the run to pass while another tool is absent', () => {
        const root = project({
            typecheck: { cmd: 'node -e ""', fast: true },
            security: { cmd: `${MISSING_BIN} .`, fast: true },
        });

        const out = runSensors({ cwd: root });

        expect(out.sensors.find(s => s.name === 'typecheck')!.status).toBe('pass');
        expect(out.overall).toBe('fail');
    });

    it('does not misread a tool that ran and merely printed "not found" as an absent tool', () => {
        // Exits 1, not 127: the binary existed and reported something of its own.
        // Classifying this as a missing tool would be a false accusation.
        const root = project({
            security: { cmd: `node -e "console.error('rule pack not found'); process.exit(1)"`, fast: true },
        });

        const out = runSensors({ cwd: root });

        const security = out.sensors.find(s => s.name === 'security');
        expect(security!.status).toBe('skipped');
        expect(security!.errors).toEqual([]);
    });
});
