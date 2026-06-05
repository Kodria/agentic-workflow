import os from 'os';
import path from 'path';
import { getInjection } from '../../src/providers';

describe('getInjection', () => {
    it('returns cc-settings-merge for claude-code', () => {
        const inj = getInjection('claude-code');
        expect(inj?.type).toBe('cc-settings-merge');
    });

    it('returns config-instructions for opencode pointing at the global opencode.json', () => {
        const inj = getInjection('opencode');
        expect(inj).toEqual({
            type: 'config-instructions',
            configPath: path.join(os.homedir(), '.config/opencode/opencode.json'),
            field: 'instructions',
        });
    });

    it('returns undefined for antigravity (no injection mechanism wired yet)', () => {
        expect(getInjection('antigravity')).toBeUndefined();
    });
});
