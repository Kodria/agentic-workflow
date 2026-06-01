import fs from 'fs';
import path from 'path';

const REGISTRY = path.join(__dirname, '..', '..', '..', 'registry');
const SKILLS = path.join(REGISTRY, 'skills');
const PROCESSES_FILE = path.join(REGISTRY, 'processes.json');
const LOCK_FILE = path.join(__dirname, '..', '..', '..', 'skills-lock.json');

function frontmatter(skill: string): string {
  const content = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  expect(match).not.toBeNull();
  return match![1];
}

describe('frontend-craft skill', () => {
  it('exists with valid frontmatter', () => {
    const fm = frontmatter('frontend-craft');
    expect(fm).toMatch(/^name:\s*frontend-craft\s*$/m);
    expect(fm).toMatch(/^description:\s*.+$/m);
  });

  it('bundles emil and taste as internal references', () => {
    const ref = path.join(SKILLS, 'frontend-craft', 'reference');
    expect(fs.existsSync(path.join(ref, 'emil-design-eng.md'))).toBe(true);
    expect(fs.existsSync(path.join(ref, 'design-taste-frontend.md'))).toBe(true);
  });

  it('SKILL.md points to its reference files', () => {
    const content = fs.readFileSync(path.join(SKILLS, 'frontend-craft', 'SKILL.md'), 'utf-8');
    expect(content).toMatch(/reference\/emil-design-eng\.md/);
    expect(content).toMatch(/reference\/design-taste-frontend\.md/);
  });
});

describe('impeccable skill (non-live scope)', () => {
  const base = path.join(SKILLS, 'impeccable');

  it('exists with valid frontmatter', () => {
    expect(fs.existsSync(path.join(base, 'SKILL.md'))).toBe(true);
  });

  it('has no literal .agents/skills/impeccable paths in markdown', () => {
    const mdFiles = [
      path.join(base, 'SKILL.md'),
      ...fs.readdirSync(path.join(base, 'reference')).map((f) => path.join(base, 'reference', f)),
    ];
    for (const f of mdFiles) {
      const content = fs.readFileSync(f, 'utf-8');
      expect(content).not.toMatch(/\.agents\/skills\/impeccable/);
    }
  });

  it('dropped the live/Codex layer', () => {
    expect(fs.existsSync(path.join(base, 'agents'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'reference', 'live.md'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'reference', 'codex.md'))).toBe(false);
    const liveScripts = fs.readdirSync(path.join(base, 'scripts')).filter((f) => /^live-/.test(f) || f === 'modern-screenshot.umd.js');
    expect(liveScripts).toEqual([]);
  });

  it('kept the static detector and non-live support scripts', () => {
    const scripts = path.join(base, 'scripts');
    for (const keep of ['detect.mjs', 'context.mjs', 'critique-storage.mjs', 'impeccable-paths.mjs']) {
      expect(fs.existsSync(path.join(scripts, keep))).toBe(true);
    }
    expect(fs.existsSync(path.join(scripts, 'detector'))).toBe(true);
  });

  it('removed the live row from the commands table', () => {
    const content = fs.readFileSync(path.join(base, 'SKILL.md'), 'utf-8');
    expect(content).not.toMatch(/\|\s*`live`\s*\|/);
  });
});

describe('google stitch skills', () => {
  for (const s of ['extract-design-md', 'code-to-design', 'react-components']) {
    it(`${s} exists with SKILL.md`, () => {
      expect(fs.existsSync(path.join(SKILLS, s, 'SKILL.md'))).toBe(true);
    });
  }
});

describe('processes.json', () => {
  const processes = JSON.parse(fs.readFileSync(PROCESSES_FILE, 'utf-8')) as Array<{
    name: string; skills: string[]; workflows: string[]; agents?: string[];
  }>;

  it('core-dev includes frontend-craft', () => {
    const core = processes.find((p) => p.name === 'core-dev');
    expect(core).toBeDefined();
    expect(core!.skills).toContain('frontend-craft');
  });

  it('frontend-design process exists with the heavy design skills', () => {
    const fd = processes.find((p) => p.name === 'frontend-design');
    expect(fd).toBeDefined();
    for (const s of ['impeccable', 'ui-design', 'extract-design-md', 'code-to-design', 'react-components']) {
      expect(fd!.skills).toContain(s);
    }
  });

  it('every skill referenced by any process exists on disk', () => {
    for (const p of processes) {
      for (const skill of p.skills) {
        expect(fs.existsSync(path.join(SKILLS, skill, 'SKILL.md'))).toBe(true);
      }
    }
  });
});

describe('skills-lock.json', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as { version: number; skills: Record<string, { source: string; sourceType: string }> };

  it('records provenance for the new external skills', () => {
    for (const s of ['emil-design-eng', 'design-taste-frontend', 'impeccable', 'extract-design-md', 'code-to-design', 'react-components']) {
      expect(lock.skills[s]).toBeDefined();
      expect(lock.skills[s].source).toMatch(/.+\/.+/);
      expect(lock.skills[s].sourceType).toBe('github');
    }
  });
});
