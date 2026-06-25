import { parseCommits, determineBump, nextVersion, selectFloor, renderChangelog, RS, US } from '../../src/release/core';
import type { Commit } from '../../src/release/core';

const rec = (header: string, body = '') => `${header}${US}${body}${RS}`;
const mk = (type: string, breaking = false): Commit => ({ type, scope: null, breaking, subject: 's' });

describe('parseCommits', () => {
  it('parsea type, scope, subject', () => {
    const [c] = parseCommits(rec('feat(add): nueva flag'));
    expect(c).toEqual({ type: 'feat', scope: 'add', breaking: false, subject: 'nueva flag' });
  });

  it('scope null cuando no hay paréntesis', () => {
    expect(parseCommits(rec('fix: corrige bug'))[0].scope).toBeNull();
  });

  it('breaking por bang en el header', () => {
    expect(parseCommits(rec('feat!: rompe API'))[0].breaking).toBe(true);
  });

  it('breaking por footer BREAKING CHANGE en el body', () => {
    expect(parseCommits(rec('feat(x): y', 'cuerpo\nBREAKING CHANGE: cambia todo'))[0].breaking).toBe(true);
  });

  it('descarta commits no convencionales sin romper', () => {
    expect(parseCommits(rec('merge branch foo') + rec('feat: ok'))).toEqual([
      { type: 'feat', scope: null, breaking: false, subject: 'ok' },
    ]);
  });

  it('entrada vacía → arreglo vacío', () => {
    expect(parseCommits('')).toEqual([]);
  });
});

describe('determineBump', () => {
  it('breaking → major (gana sobre feat/fix)', () => {
    expect(determineBump([mk('fix'), mk('feat', true)])).toBe('major');
  });
  it('feat sin breaking → minor', () => {
    expect(determineBump([mk('fix'), mk('feat')])).toBe('minor');
  });
  it('fix o perf → patch', () => {
    expect(determineBump([mk('fix')])).toBe('patch');
    expect(determineBump([mk('perf')])).toBe('patch');
  });
  it('solo docs/chore/refactor → null (nada releasable)', () => {
    expect(determineBump([mk('docs'), mk('chore'), mk('refactor')])).toBeNull();
  });
  it('lista vacía → null', () => {
    expect(determineBump([])).toBeNull();
  });
});

describe('nextVersion', () => {
  it('major resetea minor y patch', () => {
    expect(nextVersion('2.1.1', 'major')).toBe('3.0.0');
  });
  it('minor resetea patch', () => {
    expect(nextVersion('2.1.1', 'minor')).toBe('2.2.0');
  });
  it('patch incrementa patch', () => {
    expect(nextVersion('2.1.1', 'patch')).toBe('2.1.2');
  });
  it('tolera espacios alrededor', () => {
    expect(nextVersion('  2.1.1  ', 'patch')).toBe('2.1.2');
  });
  it.each(['', '.', '..', 'x.y.z', '2.1', '2.1.1.0'])('rechaza base inválida %p', (bad) => {
    expect(() => nextVersion(bad as string, 'patch')).toThrow(/invalid base version/i);
  });
});

describe('selectFloor', () => {
  it('sin tag → usa la versión del package.json', () => {
    expect(selectFloor('2.1.1', null)).toBe('2.1.1');
  });
  it('package.json mayor que el tag → gana package.json (caso drift real)', () => {
    expect(selectFloor('2.1.1', '1.0.0')).toBe('2.1.1');
  });
  it('tag mayor que package.json → gana el tag', () => {
    expect(selectFloor('2.1.1', '2.5.0')).toBe('2.5.0');
  });
  it('iguales → ese valor', () => {
    expect(selectFloor('2.1.1', '2.1.1')).toBe('2.1.1');
  });
  it('rechaza current inválido', () => {
    expect(() => selectFloor('', null)).toThrow(/invalid/i);
  });
});

describe('renderChangelog', () => {
  const commits: Commit[] = [
    { type: 'feat', scope: 'add', breaking: false, subject: 'flag --all' },
    { type: 'fix', scope: null, breaking: false, subject: 'corrige width' },
    { type: 'chore', scope: null, breaking: true, subject: 'sube node' },
  ];

  it('encabeza con versión y fecha', () => {
    expect(renderChangelog('2.2.0', '2026-06-25', commits)).toContain('## v2.2.0 - 2026-06-25');
  });
  it('agrupa Features, Fixes y Breaking Changes', () => {
    const md = renderChangelog('2.2.0', '2026-06-25', commits);
    expect(md).toContain('### Features');
    expect(md).toContain('- **add:** flag --all');
    expect(md).toContain('### Fixes');
    expect(md).toContain('- corrige width');
    expect(md).toContain('### Breaking Changes');
    expect(md).toContain('- sube node');
  });
  it('omite secciones vacías', () => {
    const md = renderChangelog('2.2.1', '2026-06-25', [
      { type: 'fix', scope: null, breaking: false, subject: 'x' },
    ]);
    expect(md).toContain('### Fixes');
    expect(md).not.toContain('### Features');
  });
});
