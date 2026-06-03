// Idempotent: inserts `version: "1.0.0"` into each SKILL.md frontmatter
// right after the `name:` line, only if no version field exists yet.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '../../registry/skills');

const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')));

let changed = 0;
for (const e of dirs) {
    const file = path.join(SKILLS_DIR, e.name, 'SKILL.md');
    const raw = fs.readFileSync(file, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) { console.warn(`SKIP (no frontmatter): ${e.name}`); continue; }
    if (/^version:\s*/m.test(m[1])) continue; // already has version
    const newFm = m[1].replace(/^(name:.*)$/m, `$1\nversion: "1.0.0"`);
    const updated = raw.replace(m[1], newFm);
    fs.writeFileSync(file, updated, 'utf-8');
    changed++;
}
console.log(`Updated ${changed} skill(s).`);
