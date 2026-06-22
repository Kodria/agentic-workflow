import { isInteractive, terminalSize } from '../../src/ui/tty';

describe('isInteractive', () => {
  const outTTY = process.stdout.isTTY;
  const inTTY = process.stdin.isTTY;
  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: outTTY, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: inTTY, configurable: true });
  });

  it('is true only when both stdin and stdout are TTYs', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    expect(isInteractive()).toBe(true);
  });
  it('is false when stdout is not a TTY (piped output)', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    expect(isInteractive()).toBe(false);
  });
});

describe('terminalSize', () => {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', { value: cols, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
  });

  it('reports the stdout dimensions', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 40, configurable: true });
    expect(terminalSize()).toEqual({ columns: 120, rows: 40 });
  });
  it('falls back to 80x24 when dimensions are undefined', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: undefined, configurable: true });
    expect(terminalSize()).toEqual({ columns: 80, rows: 24 });
  });
});
