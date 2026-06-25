import { parseCommits, determineBump, RS, US } from '../../src/release/core';
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
