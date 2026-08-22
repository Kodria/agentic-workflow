import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDoctor } from '../../src/commands/doctor';

export type DoctorJsonFixture = 'bare-home' | 'project';

export interface CapturedDoctorJsonFixture {
    cleanup(): void;
    output: string;
}

/** Captures the legacy doctor JSON in an isolated, deterministic filesystem. */
export function captureDoctorJsonFixture(kind: DoctorJsonFixture): CapturedDoctorJsonFixture {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `awm-doctor-${kind}-`));
    const previousHome = process.env.HOME;
    const previousAwmHome = process.env.AWM_HOME;
    const output: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
    });

    process.env.HOME = tempRoot;
    process.env.AWM_HOME = path.join(tempRoot, '.awm');
    if (kind === 'project') {
        fs.mkdirSync(path.join(tempRoot, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, '.awm', 'profile.json'), '{\n  "extensions": []\n}\n');
    }

    try {
        runDoctor({ cwd: tempRoot, json: true });
        return {
            // `skills.global.target` contains HOME. Canonicalize only this
            // disposable path so the frozen legacy bytes remain portable.
            output: output.join('').replaceAll(tempRoot, '<fixture-home>'),
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
