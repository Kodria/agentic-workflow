import fs from 'fs';
import path from 'path';

export type StackDetection = { pack: string; indicators: string[] };

const DETECTORS: Array<{ pack: string; files: string[] }> = [
    { pack: 'js-ts', files: ['package.json'] },
    { pack: 'python', files: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'] },
];

/** Read-only stack classification shared by run, bootstrap, and legacy init. */
export function detectStack(cwd: string): StackDetection {
    for (const { pack, files } of DETECTORS) {
        const indicators = files.filter(file => fs.existsSync(path.join(cwd, file)));
        if (indicators.length > 0) return { pack, indicators };
    }
    for (const directory of ['.', 'scripts']) {
        const absolute = path.join(cwd, directory);
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) continue;
        const indicators = fs.readdirSync(absolute, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.sh'))
            .map(entry => directory === '.' ? entry.name : path.join(directory, entry.name));
        if (indicators.length > 0) return { pack: 'shell', indicators };
    }
    return { pack: 'generic', indicators: [] };
}
