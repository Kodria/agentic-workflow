import { stripAnsi, displayWidth, truncate, wrap } from '../../src/ui/text';
import pc from 'picocolors';

describe('stripAnsi', () => {
  it('removes color escape sequences', () => {
    expect(stripAnsi(pc.green('hi'))).toBe('hi');
  });
});

describe('displayWidth', () => {
  it('counts plain ASCII one cell each', () => {
    expect(displayWidth('hello')).toBe(5);
  });
  it('ignores color codes', () => {
    expect(displayWidth(pc.red('abc'))).toBe(3);
  });
  it('counts an emoji as two cells and ignores the VS16 selector', () => {
    expect(displayWidth('📦')).toBe(2);
    expect(displayWidth('✍️')).toBe(2);
  });
});

describe('truncate', () => {
  it('returns the string unchanged when it fits', () => {
    expect(truncate('abc', 5)).toBe('abc');
  });
  it('truncates and appends an ellipsis, never exceeding width', () => {
    const out = truncate('abcdefgh', 5);
    expect(out).toBe('abcd…');
    expect(displayWidth(out)).toBeLessThanOrEqual(5);
  });
  it('returns empty for non-positive width', () => {
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('wrap', () => {
  it('breaks text at word boundaries within width', () => {
    expect(wrap('the quick brown fox', 9)).toEqual(['the quick', 'brown fox']);
  });
  it('returns a single empty line for empty input', () => {
    expect(wrap('', 10)).toEqual(['']);
  });
});
