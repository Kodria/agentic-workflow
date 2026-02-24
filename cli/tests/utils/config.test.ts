// tests/utils/config.test.ts
import { getPreferences, savePreferences } from '../../src/utils/config';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Preferences Manager', () => {
    const PREFS_DIR = path.join(os.homedir(), '.awm');
    const PREFS_FILE = path.join(PREFS_DIR, 'preferences.json');

    afterEach(() => {
        if (fs.existsSync(PREFS_FILE)) fs.unlinkSync(PREFS_FILE);
        if (fs.existsSync(PREFS_DIR)) fs.rmdirSync(PREFS_DIR);
    });

    it('creates default preferences if none exist', () => {
        const prefs = getPreferences();
        expect(prefs.defaultAgent).toBe('antigravity');
    });

    it('saves and loads preferences correctly', () => {
        savePreferences({ defaultAgent: 'opencode', installMethod: 'copy', defaultScope: 'local' });
        const prefs = getPreferences();
        expect(prefs.defaultAgent).toBe('opencode');
        expect(prefs.installMethod).toBe('copy');
    });
});
