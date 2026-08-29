import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');

describe('native release artifacts', () => {
    it('keeps native prebuilds generated instead of versioned source', () => {
        const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
        const tracked = execFileSync('git', ['ls-files', '--', 'cli/prebuilds'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        }).trim();

        expect(gitignore).toContain('cli/prebuilds/');
        expect(tracked).toBe('');
    });
});
