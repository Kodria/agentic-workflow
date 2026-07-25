import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Preferences Manager', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-prefs-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-prefs-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = tmpHome;
        jest.resetModules();
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        jest.resetModules();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    it('creates default preferences if none exist', () => {
        const { getPreferences } = require('../../src/utils/config');

        expect(getPreferences()).toEqual({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });
    });

    it('preferencesExist reflects whether the file is on disk', () => {
        const { getPreferences, preferencesExist } = require('../../src/utils/config');

        expect(preferencesExist()).toBe(false);
        getPreferences();
        expect(preferencesExist()).toBe(true);
    });

    it('saves and loads preferences correctly', () => {
        const { getPreferences, savePreferences } = require('../../src/utils/config');

        savePreferences({
            defaultAgent: 'opencode',
            enabledAgents: ['opencode'],
            installMethod: 'copy',
            defaultScope: 'local',
        });

        expect(getPreferences()).toEqual({
            defaultAgent: 'opencode',
            enabledAgents: ['opencode'],
            installMethod: 'copy',
            defaultScope: 'local',
        });
    });

    it('migrates defaultAgent without losing optional preferences', () => {
        fs.writeFileSync(path.join(tmpHome, 'preferences.json'), JSON.stringify({
            defaultAgent: 'claude-code',
            installMethod: 'symlink',
            defaultScope: 'local',
            baseRemote: 'https://example.test/baseline.git',
            channel: 'dev',
            pins: { baseline: '1.4.0' },
        }));

        const { getPreferences } = require('../../src/utils/config');
        const prefs = getPreferences();

        expect(prefs.enabledAgents).toEqual(['claude-code']);
        expect(prefs.baseRemote).toBe('https://example.test/baseline.git');
        expect(prefs.channel).toBe('dev');
        expect(prefs.pins).toEqual({ baseline: '1.4.0' });
        expect(JSON.parse(fs.readFileSync(path.join(tmpHome, 'preferences.json'), 'utf8')))
            .toEqual(prefs);
    });

    it('does not overwrite malformed preferences', () => {
        const file = path.join(tmpHome, 'preferences.json');
        fs.writeFileSync(file, '{"defaultAgent":');
        const before = fs.readFileSync(file, 'utf8');

        const { getPreferences } = require('../../src/utils/config');

        expect(() => getPreferences()).toThrow('preferences.json is not valid JSON');
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });

    it('deduplicates enabled agents and requires the default to remain enabled', () => {
        fs.writeFileSync(path.join(tmpHome, 'preferences.json'), JSON.stringify({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code', 'codex', 'codex'],
            installMethod: 'symlink',
            defaultScope: 'local',
        }));

        const { getPreferences } = require('../../src/utils/config');

        expect(getPreferences().enabledAgents).toEqual(['claude-code', 'codex']);
    });

    it('rejects preferences whose default agent is disabled', () => {
        fs.writeFileSync(path.join(tmpHome, 'preferences.json'), JSON.stringify({
            defaultAgent: 'claude-code',
            enabledAgents: ['codex'],
            installMethod: 'symlink',
            defaultScope: 'local',
        }));

        const { getPreferences } = require('../../src/utils/config');

        expect(() => getPreferences())
            .toThrow('preferences.json defaultAgent must be included in enabledAgents');
    });

    it.each([
        ['a non-object value', [], 'preferences.json must contain a JSON object'],
        ['an invalid defaultAgent', {
            defaultAgent: 'unknown',
            installMethod: 'symlink',
            defaultScope: 'local',
        }, 'preferences.json has an invalid defaultAgent'],
        ['an invalid installMethod', {
            defaultAgent: 'claude-code',
            installMethod: 'hardlink',
            defaultScope: 'local',
        }, 'preferences.json has an invalid installMethod'],
        ['an invalid defaultScope', {
            defaultAgent: 'claude-code',
            installMethod: 'symlink',
            defaultScope: 'workspace',
        }, 'preferences.json has an invalid defaultScope'],
        ['an invalid enabledAgents field', {
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code', 'unknown'],
            installMethod: 'symlink',
            defaultScope: 'local',
        }, 'preferences.json has an invalid enabledAgents'],
    ])('rejects %s', (_name, value, message) => {
        fs.writeFileSync(path.join(tmpHome, 'preferences.json'), JSON.stringify(value));
        const { getPreferences } = require('../../src/utils/config');

        expect(() => getPreferences()).toThrow(message);
    });

    it('validates preferences before saving them', () => {
        const { savePreferences } = require('../../src/utils/config');

        expect(() => savePreferences({
            defaultAgent: 'codex',
            enabledAgents: ['claude-code'],
            installMethod: 'symlink',
            defaultScope: 'local',
        })).toThrow('preferences.json defaultAgent must be included in enabledAgents');
        expect(fs.existsSync(path.join(tmpHome, 'preferences.json'))).toBe(false);
    });
});
