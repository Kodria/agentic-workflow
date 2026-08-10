import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveScopeOption } from '../../src/utils/config';

// Regression for the `awm remove <bundle> --yes` gap found running the issue #55
// Windows playbook (CORE-17): `--yes` skipped the agent prompt but not the scope
// one, so a supposedly non-interactive removal still hung waiting on a picker.
// D-006's own stated rule is "`--yes` implica cero prompts" — this closes the one
// call site that had drifted from it.
describe('resolveScopeOption', () => {
    it('falls back to the default when nothing explicit was passed (the --yes path)', () => {
        expect(resolveScopeOption(undefined, 'local')).toEqual({ ok: true, scope: 'local' });
        expect(resolveScopeOption(undefined, 'global')).toEqual({ ok: true, scope: 'global' });
    });

    it('an explicit valid value wins over the default', () => {
        expect(resolveScopeOption('global', 'local')).toEqual({ ok: true, scope: 'global' });
    });

    it('rejects a value that is neither local nor global', () => {
        expect(resolveScopeOption('bogus', 'local')).toEqual({
            ok: false,
            error: 'Invalid scope "bogus". Use: local or global.',
        });
    });
});

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
            futurePreference: { mode: 'preview' },
        }));

        const { getPreferences } = require('../../src/utils/config');
        const prefs = getPreferences();

        expect(prefs.enabledAgents).toEqual(['claude-code']);
        expect(prefs.baseRemote).toBe('https://example.test/baseline.git');
        expect(prefs.channel).toBe('dev');
        expect(prefs.pins).toEqual({ baseline: '1.4.0' });
        expect((prefs as unknown as Record<string, unknown>).futurePreference)
            .toEqual({ mode: 'preview' });
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

    it.each([
        ['an empty baseRemote', { baseRemote: '' }, 'preferences.json has an invalid baseRemote'],
        ['a non-string baseRemote', { baseRemote: 42 }, 'preferences.json has an invalid baseRemote'],
        ['an invalid channel', { channel: 'preview' }, 'preferences.json has an invalid channel'],
        ['an array pins value', { pins: [] }, 'preferences.json has invalid pins'],
        ['a null pins value', { pins: null }, 'preferences.json has invalid pins'],
        ['an empty pin name', { pins: { '': '1.2.3' } }, 'preferences.json has invalid pins'],
        ['an empty pin value', { pins: { baseline: '' } }, 'preferences.json has invalid pins'],
        ['a non-string pin value', { pins: { baseline: 123 } }, 'preferences.json has invalid pins'],
    ])('rejects %s without overwriting the file', (_name, invalidField, message) => {
        const file = path.join(tmpHome, 'preferences.json');
        const before = JSON.stringify({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code'],
            installMethod: 'symlink',
            defaultScope: 'local',
            ...invalidField,
        });
        fs.writeFileSync(file, before);
        const { getPreferences } = require('../../src/utils/config');

        expect(() => getPreferences()).toThrow(message);
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });

    it('rejects incomplete updates without dropping enabled agents', () => {
        const config: typeof import('../../src/utils/config') = require('../../src/utils/config');
        config.savePreferences({
            defaultAgent: 'claude-code',
            enabledAgents: ['claude-code', 'codex'],
            installMethod: 'symlink',
            defaultScope: 'local',
        });

        const incomplete = {
            defaultAgent: 'opencode',
            installMethod: 'copy',
            defaultScope: 'global',
        };
        expect(() => {
            // @ts-expect-error enabledAgents is required for every preference update
            config.savePreferences(incomplete);
        }).toThrow('preferences.json has an invalid enabledAgents');
        expect(config.getPreferences().enabledAgents).toEqual(['claude-code', 'codex']);
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
