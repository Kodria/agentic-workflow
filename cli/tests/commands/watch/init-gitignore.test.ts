import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { initWatch } from '../../../src/commands/watch/init';
import { AWM_GITIGNORE_BEGIN, AWM_GITIGNORE_END } from '../../../src/core/awm-gitignore';
import { isAwmGitignored } from '../../../src/core/tracks/git';

describe('initWatch managed awm gitignore (GI-2/GI-10)', () => {
    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-watch-gi-'));
        execFileSync('git', ['init'], { cwd: repo, stdio: 'pipe' });
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    });
    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('writes the managed block instead of a bare .awm/ allow-nothing rule', () => {
        initWatch(repo, 'rama');
        const gi = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
        expect(gi).toContain(AWM_GITIGNORE_BEGIN);
        expect(gi).toContain(AWM_GITIGNORE_END);
        expect(gi).toContain('!.awm/sensors.json');
        expect(gi).toContain('!.awm/profile.json');
        // Bare directory ignore alone is migrated away; managed uses .awm/*
        const lines = gi.split('\n').map((l) => l.trim()).filter(Boolean);
        const outside = lines.filter((l) => l !== AWM_GITIGNORE_BEGIN && l !== AWM_GITIGNORE_END && !l.startsWith('.awm') && !l.startsWith('!.awm'));
        expect(lines.filter((l) => l === '.awm' || l === '.awm/')).toEqual([]);
        expect(outside.length).toBeGreaterThanOrEqual(0);
        expect(isAwmGitignored(repo)).toBe(true);
    });
});
