import fs from 'fs';
import path from 'path';
import os from 'os';
import { packSkill, defaultZip } from '../../../src/core/export/pack';
import { ZipFn } from '../../../src/core/export/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const childProcess = require('child_process');

const okZip: ZipFn = (cwd, zipName) => {
    fs.writeFileSync(path.join(cwd, zipName), 'fake-zip');
    return { ok: true, missing: false };
};
const missingZip: ZipFn = () => ({ ok: false, missing: true });

describe('packSkill', () => {
    let src: string;
    let out: string;
    beforeEach(() => {
        src = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-src-'));
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-out-'));
        fs.writeFileSync(path.join(src, 'SKILL.md'), 'canonical');
        fs.mkdirSync(path.join(src, 'references'));
        fs.writeFileSync(path.join(src, 'references/a.md'), 'ref-A bytes');
    });
    afterEach(() => {
        fs.rmSync(src, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('writes adapted SKILL.md and byte-identical references', () => {  // verifies R3.2, R4
        const r = packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: okZip });
        expect(fs.readFileSync(path.join(out, 'x/SKILL.md'), 'utf-8')).toBe('adapted');
        expect(fs.readFileSync(path.join(out, 'x/references/a.md'), 'utf-8')).toBe('ref-A bytes');
        expect(r.zip).toBe(path.join(out, 'x.zip'));
    });

    it('re-export cleans its own subtree first (stale files gone)', () => {  // verifies R4
        fs.mkdirSync(path.join(out, 'x'), { recursive: true });
        fs.writeFileSync(path.join(out, 'x/stale.md'), 'old');
        fs.writeFileSync(path.join(out, 'x.zip'), 'old-zip');
        packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: missingZip });
        expect(fs.existsSync(path.join(out, 'x/stale.md'))).toBe(false);
        expect(fs.existsSync(path.join(out, 'x.zip'))).toBe(false);
    });

    it('falls back to folder-only when zip binary is missing', () => {  // verifies R4.2
        const r = packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: missingZip });
        expect(r.zip).toBeNull();
        expect(r.zipMissing).toBe(true);
        expect(fs.existsSync(path.join(out, 'x/SKILL.md'))).toBe(true);
    });

    it('skill without references/ packs SKILL.md alone', () => {  // verifies R4
        fs.rmSync(path.join(src, 'references'), { recursive: true });
        packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: okZip });
        expect(fs.existsSync(path.join(out, 'x/references'))).toBe(false);
    });

    it('throws when the zip function reports a real failure (not missing binary)', () => {  // verifies R4.1
        const failingZip: ZipFn = () => ({ ok: false, missing: false });
        expect(() => packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: failingZip }))
            .toThrow(/zip failed/);
    });

    it('refuses to export when references/ contains a symlink (blocks zip-dereference exfiltration)', () => {
        // Simulate the exfiltration shape: a "secret" file living entirely
        // outside srcDir, symlinked from within references/.
        const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-secret-'));
        const secretPath = path.join(secretsDir, 'id_rsa');
        const secretContents = 'THIS-IS-A-PRIVATE-KEY-SHOULD-NEVER-LEAK';
        fs.writeFileSync(secretPath, secretContents);
        fs.symlinkSync(secretPath, path.join(src, 'references/evil-link'));

        try {
            expect(() =>
                packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: okZip })
            ).toThrow(/symlink/i);

            // Nothing under targetRoot should ever contain the secret's bytes,
            // whether as a copied symlink or a dereferenced regular file.
            const walk = (dir: string): string[] => {
                if (!fs.existsSync(dir)) return [];
                return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) return walk(full);
                    if (e.isSymbolicLink()) return [full]; // leaked symlink itself is also unacceptable
                    return [full];
                });
            };
            for (const f of walk(out)) {
                const st = fs.lstatSync(f);
                if (st.isSymbolicLink()) {
                    throw new Error(`leaked symlink found under targetRoot: ${f}`);
                }
                const contents = fs.readFileSync(f, 'utf-8');
                expect(contents).not.toContain(secretContents);
            }
        } finally {
            fs.rmSync(secretsDir, { recursive: true, force: true });
        }
    });
});

describe('defaultZip (system binary, layered)', () => {
    it('produces a real zip when the binary exists, or reports missing', () => {  // verifies R4.1, R4.2
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-zip-'));
        fs.mkdirSync(path.join(cwd, 'folder'));
        fs.writeFileSync(path.join(cwd, 'folder/f.txt'), 'x');
        const r = defaultZip(cwd, 'folder.zip', 'folder');
        if (r.missing) {
            expect(fs.existsSync(path.join(cwd, 'folder.zip'))).toBe(false);  // degrade limpio
        } else {
            expect(r.ok).toBe(true);
            expect(fs.existsSync(path.join(cwd, 'folder.zip'))).toBe(true);
        }
        fs.rmSync(cwd, { recursive: true, force: true });
    });

    it('returns missing:true when spawnSync reports ENOENT (binary absent)', () => {  // verifies R4.2
        const spy = jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
            error: Object.assign(new Error('spawn zip ENOENT'), { code: 'ENOENT' }),
        } as unknown as ReturnType<typeof childProcess.spawnSync>);
        const r = defaultZip('/irrelevant', 'folder.zip', 'folder');
        expect(r).toEqual({ ok: false, missing: true });
        spy.mockRestore();
    });
});
