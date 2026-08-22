import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDoctor } from '../../src/commands/doctor';

export type DoctorJsonFixture = 'bare-home' | 'project';

export interface CapturedDoctorJsonFixture {
    cleanup(): void;
    code: number;
    output: string;
}

/** Captures the legacy doctor JSON in an isolated, deterministic filesystem. */
export function captureDoctorJsonFixture(kind: DoctorJsonFixture): CapturedDoctorJsonFixture {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-json-fixture-'));
    const previousHome = process.env.HOME;
    const previousAwmHome = process.env.AWM_HOME;
    const output: string[] = [];
    fs.mkdirSync(path.join(tempRoot, '.awm'), { recursive: true });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
    });

    process.env.HOME = tempRoot;
    process.env.AWM_HOME = path.join(tempRoot, '.awm');
    fs.writeFileSync(path.join(tempRoot, '.awm', 'preferences.json'), JSON.stringify({
        defaultAgent: 'copilot',
        enabledAgents: ['copilot'],
        installMethod: 'symlink',
        defaultScope: 'local',
    }, null, 2) + '\n');
    if (kind === 'project') {
        fs.writeFileSync(path.join(tempRoot, '.awm', 'profile.json'), '{\n  "extensions": []\n}\n');
        fs.writeFileSync(path.join(tempRoot, 'AGENTS.md'), '<!-- AWM:START -->\nstale project context\n<!-- AWM:END -->\n');
    }

    try {
        const code = runDoctor({ cwd: tempRoot, json: true });
        return {
            code,
            output: output.join(''),
            cleanup: () => {
                writeSpy.mockRestore();
                fs.rmSync(tempRoot, { recursive: true, force: true });
                if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
                if (previousAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previousAwmHome;
            },
        };
    } catch (error) {
        writeSpy.mockRestore();
        fs.rmSync(tempRoot, { recursive: true, force: true });
        if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
        if (previousAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previousAwmHome;
        throw error;
    }
}
