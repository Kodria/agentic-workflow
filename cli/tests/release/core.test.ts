import { parseCommits, RS, US } from '../../src/release/core';

const rec = (header: string, body = '') => `${header}${US}${body}${RS}`;

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
