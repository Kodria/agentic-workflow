import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const FACTORY = 'src/core/registry-git.ts';

describe('simple-git v4 pin (#238)', () => {
    it('pins simple-git exactly to 4.0.2', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')) as {
            dependencies: Record<string, string>;
        };
        expect(pkg.dependencies['simple-git']).toBe('4.0.2');
    });

    it('imports simple-git only from registry-git.ts via named simpleGit', () => {
        const factory = fs.readFileSync(path.join(CLI_ROOT, FACTORY), 'utf8');
        expect(factory).toMatch(/import\s*\{[^}]*\bsimpleGit\b[^}]*\}\s*from\s*['"]simple-git['"]/);
        expect(factory).not.toMatch(/import\s+simpleGit\s+from\s*['"]simple-git['"]/);

        const walk = (dir: string): string[] => {
            const out: string[] = [];
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) out.push(...walk(p));
                else if (ent.name.endsWith('.ts')) out.push(p);
            }
            return out;
        };
        for (const file of walk(path.join(CLI_ROOT, 'src'))) {
            const rel = path.relative(CLI_ROOT, file).replace(/\\/g, '/');
            if (rel === FACTORY) continue;
            const text = fs.readFileSync(file, 'utf8');
            expect(text).not.toMatch(/from\s*['"]simple-git['"]/);
            expect(text).not.toMatch(/\bsimpleGit\s*\(/);
        }
    });

    it('factory allowEnvironment is only GIT_TERMINAL_PROMPT and enables no allowUnsafe*', () => {
        const factory = fs.readFileSync(path.join(CLI_ROOT, FACTORY), 'utf8');
        expect(factory).toMatch(/allowEnvironment:\s*\[\s*['"]GIT_TERMINAL_PROMPT['"]\s*\]/);
        expect(factory).not.toMatch(/allowUnsafe/);
        // B1 / V1: factory must use the shared constant (not a duplicated literal).
        expect(factory).toMatch(/timeout:\s*\{\s*block:\s*REGISTRY_GIT_TIMEOUT_MS\s*\}/);
        expect(factory).toMatch(/export\s+const\s+REGISTRY_GIT_TIMEOUT_MS\s*=\s*60_?000\s*;/);
        // SG-3: guarded env must be applied — deleting `.env(buildRegistryGitEnv())` must fail this pin.
        expect(factory).toMatch(/\.env\(\s*buildRegistryGitEnv\(\)/);
    });
});
