// tests/utils/config.test.ts
import { getPreferences, savePreferences, preferencesExist } from '../../src/utils/config';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Preferences Manager', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-prefs-'));
        process.env.AWM_HOME = tmpDir;
    });

    afterEach(() => {
        delete process.env.AWM_HOME;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates default preferences if none exist (default agent is claude-code)', () => {
        const prefs = getPreferences();
        expect(prefs.defaultAgent).toBe('claude-code');
    });

    it('preferencesExist reflects whether the file is on disk', () => {
        expect(preferencesExist()).toBe(false);
        getPreferences(); // side-effect: persists defaults
        expect(preferencesExist()).toBe(true);
    });

    it('saves and loads preferences correctly', () => {
        savePreferences({ defaultAgent: 'opencode', installMethod: 'copy', defaultScope: 'local' });
        const prefs = getPreferences();
        expect(prefs.defaultAgent).toBe('opencode');
        expect(prefs.installMethod).toBe('copy');
    });
});
