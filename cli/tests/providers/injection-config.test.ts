import os from 'os';
import path from 'path';
import { getInjection } from '../../src/providers';
import { homeDir } from '../../src/core/paths';

describe('getInjection', () => {
    it('returns cc-settings-merge for claude-code', () => {
        const inj = getInjection('claude-code');
        expect(inj?.type).toBe('cc-settings-merge');
    });

    it('returns config-instructions for opencode pointing at the global opencode.json', () => {
        // Windows os.homedir() uses USERPROFILE while the CLI honors HOME.
        const systemHome = jest.spyOn(os, 'homedir').mockReturnValue(path.resolve('different-system-profile'));
        try {
            const inj = getInjection('opencode');
            expect(inj).toEqual({
                type: 'config-instructions',
                configPath: path.join(homeDir(), '.config/opencode/opencode.json'),
                field: 'instructions',
            });
        } finally { systemHome.mockRestore(); }
    });

    it('returns undefined for antigravity (no injection mechanism wired yet)', () => {
        expect(getInjection('antigravity')).toBeUndefined();
    });

    it('returns managed-agents-md for cursor, with no confirmed global path (D4)', () => {
        const inj = getInjection('cursor');
        expect(inj).toEqual({
            type: 'managed-agents-md',
            globalPath: null,
            localFile: 'AGENTS.md',
        });
    });

    it('returns managed-agents-md for copilot, project-root only (D4: no global equivalent)', () => {
        const inj = getInjection('copilot');
        expect(inj).toEqual({
            type: 'managed-agents-md',
            globalPath: null,
            localFile: 'AGENTS.md',
        });
    });
});
