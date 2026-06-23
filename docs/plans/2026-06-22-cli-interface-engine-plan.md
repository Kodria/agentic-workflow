# CLI Interface Engine Implementation Plan
<!-- awm-qa-complete: 2026-06-22 -->
<!-- awm-retro-complete: 2026-06-22 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a readable, navigable interface engine for AWM's dense lists — a pure render layer plus a two-pane interactive multiselect picker — and wire it into `awm list` and `awm add`.

**Architecture:** Every layout decision is a pure function `(data, width) → string[]`, fully testable without a terminal. A thin I/O shell reads raw keys and redraws inline (no full-screen / alternate-screen buffer). Non-interactive environments never enter the picker and fall back to flags.

**Tech Stack:** TypeScript, Node (`process.stdin.setRawMode`), `picocolors`, Jest (`ts-jest`). No new heavy dependencies. `@clack/prompts` is kept for spinner/intro/outro/confirm and short selectors.

**Design source:** `docs/plans/2026-06-22-cli-interface-engine-design.md`
**Branch:** `feat/cli-interface-engine` (already created)

---

## Key Refinement vs. Design (read first)

The design doc (§5) listed keys as "`/` o escribir … filtrar · `a` marca todo". During planning we found `a` collides with filter typing (it's a valid filter character). **Resolved key model used by this plan** (conflict-free):

- `↑/↓` move · `space` toggle current · **`Tab`** toggle-all-visible · type `[a-zA-Z0-9-]` to filter live · `backspace` edit filter · `⏎` confirm · `Esc` clears filter if present, else cancels · `Ctrl-C` cancels.

Typing filters directly, so the `/` affordance is unnecessary. This is the contract the tasks implement.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/text.ts` (new) | Width math: `stripAnsi`, `displayWidth`, `truncate`, `wrap`. Pure. |
| `src/ui/tty.ts` (new) | `isInteractive()`, `terminalSize()`. Thin process probes. |
| `src/ui/picker-view.ts` (new) | `PickerItem`/`PickerState` types, `visibleItems`, `renderPicker` (two-pane / one-pane). Pure. |
| `src/ui/picker.ts` (new) | `parseKey`, `pickerReducer` (pure), `multiselectPicker` (raw-mode I/O shell with injectable streams). |
| `src/utils/registry-view.ts` (modify) | Static `awm list` renderers become width-aware; add `packagePickerItems`/`artifactPickerItems`; remove dead clack option builders. |
| `src/index.ts` (modify) | Wire `awm list` (width-aware) and `awm add` (picker + non-interactive guard). |

Test files mirror under `tests/ui/` and `tests/utils/`.

---

## Task 1: Width-math utilities (`src/ui/text.ts`)

**Files:**
- Create: `src/ui/text.ts`
- Test: `tests/ui/text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/text.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/text.test.ts`
Expected: FAIL — "Cannot find module '../../src/ui/text'".

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/text.ts
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
    (cp >= 0x2300 && cp <= 0x23ff) ||   // misc technical (⏎ etc.)
    (cp >= 0x2600 && cp <= 0x27bf) ||   // misc symbols / dingbats
    (cp >= 0x1f000 && cp <= 0x1faff)    // emoji
  );
}

/** Visible terminal cells, ignoring ANSI color and treating known wide glyphs as 2. */
export function displayWidth(s: string): number {
  const plain = stripAnsi(s);
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfe0f) continue; // variation selector — zero width
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

/** Truncate plain text to `width` cells, appending '…'. Strips ANSI — color AFTER truncating. */
export function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  const plain = stripAnsi(s);
  if (displayWidth(plain) <= width) return plain;
  if (width === 1) return '…';
  let out = '';
  let w = 0;
  for (const ch of plain) {
    const cw = displayWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/** Word-wrap plain text to `width` cells. Long single words are not split (acceptable). */
export function wrap(s: string, width: number): string[] {
  if (width <= 0) return [s];
  const words = stripAnsi(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur === '') { cur = word; continue; }
    if (displayWidth(cur) + 1 + displayWidth(word) <= width) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ui/text.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/ui/text.ts tests/ui/text.test.ts
git commit -m "feat(ui): width-aware text utilities (stripAnsi, displayWidth, truncate, wrap)"
```

---

## Task 2: Terminal probes (`src/ui/tty.ts`)

**Files:**
- Create: `src/ui/tty.ts`
- Test: `tests/ui/tty.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/tty.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/tty.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/tty.ts

/** True only when both ends are TTYs — the precondition for the interactive picker. */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/** Current terminal size, with a safe 80x24 fallback when undefined (non-TTY). */
export function terminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ui/tty.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/tty.ts tests/ui/tty.test.ts
git commit -m "feat(ui): terminal probes (isInteractive, terminalSize)"
```

---

## Task 3: Picker view types + renderer (`src/ui/picker-view.ts`)

**Files:**
- Create: `src/ui/picker-view.ts`
- Test: `tests/ui/picker-view.test.ts`

The renderer is pure: `(state, viewport) → string[]`. Tests assert structural properties (not byte-exact frames), so the layout can evolve without churning tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/picker-view.test.ts
import { PickerItem, PickerState, visibleItems, renderPicker, TWO_PANE_MIN_COLUMNS } from '../../src/ui/picker-view';

const items: PickerItem[] = [
  { value: 'skill:architecture-advisor', label: 'architecture-advisor', description: 'Define and review system architecture.' },
  { value: 'skill:brainstorming', label: 'brainstorming', description: 'Turn ideas into designs.' },
  { value: 'skill:cicd-proposal-builder', label: 'cicd-proposal-builder', description: 'Specialist in CI/CD pipeline design. Use when defining a pipeline.' },
];

const base = (over: Partial<PickerState> = {}): PickerState => ({
  title: 'dev — select artifacts',
  items,
  selected: new Set<string>(),
  cursor: 0,
  filter: '',
  ...over,
});

describe('visibleItems', () => {
  it('returns all items with an empty filter', () => {
    expect(visibleItems(base())).toHaveLength(3);
  });
  it('filters by label substring, case-insensitive', () => {
    expect(visibleItems(base({ filter: 'CIC' })).map((i) => i.value)).toEqual(['skill:cicd-proposal-builder']);
  });
});

describe('renderPicker', () => {
  it('shows the title in the header', () => {
    const lines = renderPicker(base(), { columns: 100, rows: 20 });
    expect(lines[0]).toContain('dev — select artifacts');
  });
  it('marks the cursor row and selected rows', () => {
    const lines = renderPicker(base({ cursor: 1, selected: new Set(['skill:brainstorming']) }), { columns: 100, rows: 20 });
    const body = lines.join('\n');
    expect(body).toContain('❯');   // cursor marker
    expect(body).toContain('◼');   // a selected checkbox
    expect(body).toContain('◻');   // an unselected checkbox
  });
  it('uses two panes (a gutter) when wide', () => {
    const lines = renderPicker(base(), { columns: TWO_PANE_MIN_COLUMNS + 10, rows: 20 });
    expect(lines.some((l) => l.includes(' │ '))).toBe(true);
  });
  it('collapses to one pane (no gutter) when narrow', () => {
    const lines = renderPicker(base(), { columns: 50, rows: 20 });
    expect(lines.some((l) => l.includes(' │ '))).toBe(false);
    // the highlighted item's description still appears below the list
    expect(lines.join('\n')).toContain('Define and review');
  });
  it('shows the filter text in the header when filtering', () => {
    expect(renderPicker(base({ filter: 'cic' }), { columns: 100, rows: 20 })[0]).toContain('filter: cic');
  });
  it('reports no matches when the filter excludes everything', () => {
    expect(renderPicker(base({ filter: 'zzz' }), { columns: 100, rows: 20 }).join('\n').toLowerCase()).toContain('no matches');
  });
  it('always ends with the key hint footer', () => {
    const lines = renderPicker(base(), { columns: 100, rows: 20 });
    expect(lines[lines.length - 1]).toContain('confirm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/picker-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/picker-view.ts
import pc from 'picocolors';
import { truncate, wrap, displayWidth } from './text';

export interface PickerItem {
  value: string;        // unique (e.g. "skill:brainstorming" or the ALL sentinel)
  label: string;        // display name (may include an icon prefix)
  description: string;
}

export interface PickerState {
  title: string;
  items: PickerItem[];        // full, unfiltered list
  selected: Set<string>;      // selected values
  cursor: number;             // index into the FILTERED list
  filter: string;             // live filter text
}

export interface Viewport { columns: number; rows: number; }

export const TWO_PANE_MIN_COLUMNS = 72;
const FOOTER = '↑↓ move · space select · tab all · ⏎ confirm · esc clear';

export function visibleItems(state: PickerState): PickerItem[] {
  if (!state.filter) return state.items;
  const q = state.filter.toLowerCase();
  return state.items.filter((i) => i.label.toLowerCase().includes(q));
}

/** Compute a scroll window [start, end) around the cursor that fits `height` rows. */
function windowFor(cursor: number, total: number, height: number): [number, number] {
  if (total <= height) return [0, total];
  let start = cursor - Math.floor(height / 2);
  start = Math.max(0, Math.min(start, total - height));
  return [start, start + height];
}

function checkbox(selected: boolean): string {
  return selected ? pc.green('◼') : '◻';
}

export function renderPicker(state: PickerState, vp: Viewport): string[] {
  const vis = visibleItems(state);
  const cursor = Math.max(0, Math.min(state.cursor, vis.length - 1));
  const selCount = state.selected.size;

  const filterPart = state.filter ? `   filter: ${state.filter}` : '';
  const header = pc.bold(state.title) + filterPart + (selCount ? pc.dim(`   ${selCount} sel`) : '');

  const out: string[] = [header];

  if (vis.length === 0) {
    out.push(pc.dim('  (no matches)'));
    out.push(FOOTER);
    return out;
  }

  const bodyHeight = Math.max(3, vp.rows - 4); // header + footer + breathing room
  const [start, end] = windowFor(cursor, vis.length, bodyHeight);
  const twoPane = vp.columns >= TWO_PANE_MIN_COLUMNS;

  const listWidth = twoPane ? Math.floor(vp.columns * 0.5) : vp.columns - 2;
  const rows: string[] = [];
  for (let i = start; i < end; i++) {
    const item = vis[i];
    const isCursor = i === cursor;
    const marker = isCursor ? pc.cyan('❯') : ' ';
    const box = checkbox(state.selected.has(item.value));
    const labelWidth = listWidth - 4; // marker + space + box + space
    const label = truncate(item.label, labelWidth);
    rows.push(`${marker} ${box} ${label}`);
  }

  if (twoPane) {
    const detailWidth = vp.columns - listWidth - 3; // gutter " │ "
    const detail = wrap(vis[cursor].description, detailWidth).slice(0, rows.length);
    const height = Math.max(rows.length, detail.length);
    for (let i = 0; i < height; i++) {
      const left = (rows[i] ?? '').padEnd(listWidth + (displayWidth(rows[i] ?? '') - (rows[i] ?? '').length) * -1);
      const leftPadded = padToWidth(rows[i] ?? '', listWidth);
      const right = detail[i] ?? '';
      out.push(`${leftPadded} ${pc.dim('│')} ${pc.dim(right)}`);
    }
  } else {
    out.push(...rows);
    out.push(pc.dim('  ' + (wrap(vis[cursor].description, vp.columns - 4)[0] ?? '')));
  }

  out.push(FOOTER);
  return out;
}

/** Pad a possibly-colored string to `width` visible cells. */
function padToWidth(s: string, width: number): string {
  const pad = width - displayWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}
```

> Note: the unused `left` local in the two-pane loop is a leftover — delete it and keep only `leftPadded`. Shown here so the engineer sees the intended `padToWidth` usage; the implementer should write the clean version with just `leftPadded`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ui/picker-view.test.ts`
Expected: PASS. If the two-pane gutter assertion fails, confirm the gutter string is exactly `' │ '` (space, box-vertical, space).

- [ ] **Step 5: Commit**

```bash
git add src/ui/picker-view.ts tests/ui/picker-view.test.ts
git commit -m "feat(ui): pure picker renderer (two-pane / one-pane, scroll, filter)"
```

---

## Task 4: Key parsing + state reducer (`src/ui/picker.ts`, pure half)

**Files:**
- Create: `src/ui/picker.ts` (pure exports only in this task)
- Test: `tests/ui/picker-reducer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/picker-reducer.test.ts
import { parseKey, pickerReducer, ALL_SENTINEL } from '../../src/ui/picker';
import { PickerItem, PickerState } from '../../src/ui/picker-view';

const items: PickerItem[] = [
  { value: ALL_SENTINEL, label: '✨ Install entire package (2)', description: '' },
  { value: 'skill:a', label: 'alpha', description: '' },
  { value: 'skill:b', label: 'beta', description: '' },
];
const base = (over: Partial<PickerState> = {}): PickerState => ({
  title: 't', items, selected: new Set<string>(), cursor: 0, filter: '', ...over,
});

describe('parseKey', () => {
  it('maps arrow and control sequences', () => {
    expect(parseKey('\x1b[A')).toEqual({ action: 'up' });
    expect(parseKey('\x1b[B')).toEqual({ action: 'down' });
    expect(parseKey('\r')).toEqual({ action: 'confirm' });
    expect(parseKey(' ')).toEqual({ action: 'toggle' });
    expect(parseKey('\t')).toEqual({ action: 'toggleAll' });
    expect(parseKey('\x03')).toEqual({ action: 'cancel' });
    expect(parseKey('\x1b')).toEqual({ action: 'clearOrCancel' });
    expect(parseKey('\x7f')).toEqual({ action: 'backspace' });
  });
  it('maps filter characters and ignores the rest', () => {
    expect(parseKey('c')).toEqual({ action: 'char', char: 'c' });
    expect(parseKey('-')).toEqual({ action: 'char', char: '-' });
    expect(parseKey('?')).toEqual({ action: 'none' });
  });
});

describe('pickerReducer', () => {
  it('moves the cursor and wraps around', () => {
    expect(pickerReducer(base({ cursor: 0 }), { type: 'up' }).cursor).toBe(2);
    expect(pickerReducer(base({ cursor: 2 }), { type: 'down' }).cursor).toBe(0);
  });
  it('toggles the current item', () => {
    const s = pickerReducer(base({ cursor: 1 }), { type: 'toggle' });
    expect(s.selected.has('skill:a')).toBe(true);
    const s2 = pickerReducer(s, { type: 'toggle' });
    expect(s2.selected.has('skill:a')).toBe(false);
  });
  it('toggling the ALL sentinel selects every real item plus the sentinel', () => {
    const s = pickerReducer(base({ cursor: 0 }), { type: 'toggle' });
    expect(s.selected.has('skill:a')).toBe(true);
    expect(s.selected.has('skill:b')).toBe(true);
    expect(s.selected.has(ALL_SENTINEL)).toBe(true);
  });
  it('Tab toggles all real items without needing the sentinel row', () => {
    const s = pickerReducer(base(), { type: 'toggleAll' });
    expect(s.selected.has('skill:a')).toBe(true);
    expect(s.selected.has('skill:b')).toBe(true);
  });
  it('typing filters and resets the cursor to 0', () => {
    const s = pickerReducer(base({ cursor: 2 }), { type: 'filterChar', char: 'b' });
    expect(s.filter).toBe('b');
    expect(s.cursor).toBe(0);
  });
  it('backspace edits the filter', () => {
    expect(pickerReducer(base({ filter: 'be' }), { type: 'backspace' }).filter).toBe('b');
  });
  it('does not move the cursor when the filtered list is empty', () => {
    const s = base({ filter: 'zzz', cursor: 0 });
    expect(pickerReducer(s, { type: 'down' }).cursor).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/picker-reducer.test.ts`
Expected: FAIL — `parseKey`/`pickerReducer` not exported.

- [ ] **Step 3: Write the implementation (pure exports)**

```ts
// src/ui/picker.ts
import { PickerState, visibleItems } from './picker-view';

export const ALL_SENTINEL = '__ALL__';

export type ParsedKey =
  | { action: 'up' } | { action: 'down' }
  | { action: 'toggle' } | { action: 'toggleAll' }
  | { action: 'confirm' } | { action: 'cancel' }
  | { action: 'backspace' } | { action: 'clearOrCancel' }
  | { action: 'char'; char: string }
  | { action: 'none' };

export function parseKey(data: string): ParsedKey {
  switch (data) {
    case '\x1b[A': return { action: 'up' };
    case '\x1b[B': return { action: 'down' };
    case '\r': case '\n': return { action: 'confirm' };
    case ' ': return { action: 'toggle' };
    case '\t': return { action: 'toggleAll' };
    case '\x7f': case '\b': return { action: 'backspace' };
    case '\x03': return { action: 'cancel' };       // Ctrl-C
    case '\x1b': return { action: 'clearOrCancel' }; // Esc
  }
  if (data.length === 1 && /[a-zA-Z0-9-]/.test(data)) return { action: 'char', char: data };
  return { action: 'none' };
}

export type ReducerKey =
  | { type: 'up' } | { type: 'down' }
  | { type: 'toggle' } | { type: 'toggleAll' }
  | { type: 'filterChar'; char: string } | { type: 'backspace' };

function realValues(state: PickerState): string[] {
  return state.items.filter((i) => i.value !== ALL_SENTINEL).map((i) => i.value);
}

export function pickerReducer(state: PickerState, key: ReducerKey): PickerState {
  const vis = visibleItems(state);
  switch (key.type) {
    case 'up': {
      if (vis.length === 0) return state;
      return { ...state, cursor: (state.cursor - 1 + vis.length) % vis.length };
    }
    case 'down': {
      if (vis.length === 0) return state;
      return { ...state, cursor: (state.cursor + 1) % vis.length };
    }
    case 'toggle': {
      if (vis.length === 0) return state;
      const item = vis[Math.max(0, Math.min(state.cursor, vis.length - 1))];
      const selected = new Set(state.selected);
      if (item.value === ALL_SENTINEL) {
        const reals = realValues(state);
        const allSel = reals.every((v) => selected.has(v));
        if (allSel) { reals.forEach((v) => selected.delete(v)); selected.delete(ALL_SENTINEL); }
        else { reals.forEach((v) => selected.add(v)); selected.add(ALL_SENTINEL); }
      } else {
        if (selected.has(item.value)) selected.delete(item.value);
        else selected.add(item.value);
      }
      return { ...state, selected };
    }
    case 'toggleAll': {
      const reals = realValues(state);
      const selected = new Set(state.selected);
      const allSel = reals.every((v) => selected.has(v));
      if (allSel) { reals.forEach((v) => selected.delete(v)); selected.delete(ALL_SENTINEL); }
      else { reals.forEach((v) => selected.add(v)); }
      return { ...state, selected };
    }
    case 'filterChar':
      return { ...state, filter: state.filter + key.char, cursor: 0 };
    case 'backspace':
      return { ...state, filter: state.filter.slice(0, -1), cursor: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ui/picker-reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/picker.ts tests/ui/picker-reducer.test.ts
git commit -m "feat(ui): pure key parser and picker state reducer"
```

---

## Task 5: Interactive shell (`multiselectPicker` in `src/ui/picker.ts`)

**Files:**
- Modify: `src/ui/picker.ts` (append the I/O shell)
- Test: `tests/ui/picker-shell.test.ts`

The shell injects its streams (default-arg seam, per AGENTS.md `injected-logger`/`default-arg-seam`) so a fake stdin/stdout drives it in tests — no real TTY needed. It redraws inline (cursor-up + clear) and **always restores** raw mode and cursor visibility in `finally`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/picker-shell.test.ts
import { EventEmitter } from 'events';
import { multiselectPicker, ALL_SENTINEL } from '../../src/ui/picker';
import { PickerItem } from '../../src/ui/picker-view';

function fakeIO() {
  const input = new EventEmitter() as any;
  input.setRawMode = jest.fn();
  input.resume = jest.fn();
  input.pause = jest.fn();
  input.setEncoding = jest.fn();
  const writes: string[] = [];
  const output = { write: (s: string) => { writes.push(s); return true; }, columns: 100, rows: 20 } as any;
  return { io: { input, output }, writes, send: (s: string) => input.emit('data', s) };
}

const items: PickerItem[] = [
  { value: ALL_SENTINEL, label: '✨ all', description: '' },
  { value: 'skill:a', label: 'alpha', description: 'A.' },
  { value: 'skill:b', label: 'beta', description: 'B.' },
];

it('resolves with the toggled selection on Enter', async () => {
  const { io, send } = fakeIO();
  const p = multiselectPicker({ title: 't', items }, io);
  send('\x1b[B');  // down → cursor on alpha
  send(' ');       // toggle alpha
  send('\r');      // confirm
  await expect(p).resolves.toEqual(['skill:a']);
  expect(io.input.setRawMode).toHaveBeenLastCalledWith(false); // restored
});

it('resolves null on Ctrl-C and restores raw mode', async () => {
  const { io, send } = fakeIO();
  const p = multiselectPicker({ title: 't', items }, io);
  send('\x03');
  await expect(p).resolves.toBeNull();
  expect(io.input.setRawMode).toHaveBeenLastCalledWith(false);
});

it('seeds the initial selection', async () => {
  const { io, send } = fakeIO();
  const p = multiselectPicker({ title: 't', items, initialSelected: [ALL_SENTINEL, 'skill:a', 'skill:b'] }, io);
  send('\r');
  const result = await p;
  expect(new Set(result)).toEqual(new Set([ALL_SENTINEL, 'skill:a', 'skill:b']));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/picker-shell.test.ts`
Expected: FAIL — `multiselectPicker` not exported.

- [ ] **Step 3: Write the implementation (append to `src/ui/picker.ts`)**

```ts
// --- append to src/ui/picker.ts ---
import { renderPicker, PickerItem, PickerState } from './picker-view';

export interface PickerIO {
  input: NodeJS.ReadStream & { setRawMode?: (b: boolean) => void };
  output: NodeJS.WriteStream;
}

export interface MultiselectOptions {
  title: string;
  items: PickerItem[];
  initialSelected?: string[];
}

function defaultIO(): PickerIO {
  return { input: process.stdin, output: process.stdout };
}

/**
 * Interactive multiselect. Returns the selected values, or null if cancelled.
 * Streams are injectable for testing. Always restores terminal state on exit.
 */
export function multiselectPicker(opts: MultiselectOptions, io: PickerIO = defaultIO()): Promise<string[] | null> {
  return new Promise((resolve) => {
    let state: PickerState = {
      title: opts.title,
      items: opts.items,
      selected: new Set(opts.initialSelected ?? []),
      cursor: 0,
      filter: '',
    };
    let lastLineCount = 0;

    const size = () => ({
      columns: (io.output as any).columns ?? 80,
      rows: (io.output as any).rows ?? 24,
    });

    const draw = () => {
      const lines = renderPicker(state, size());
      // Move up over the previous frame and clear downward.
      if (lastLineCount > 0) io.output.write(`\x1b[${lastLineCount}A`);
      io.output.write('\x1b[0J');
      io.output.write(lines.join('\n') + '\n');
      lastLineCount = lines.length;
    };

    const cleanup = () => {
      io.input.removeListener('data', onData);
      try { io.input.setRawMode?.(false); } catch { /* best-effort: terminal may not support raw mode */ }
      io.input.pause?.();
      io.output.write('\x1b[?25h'); // show cursor
    };

    const onData = (chunk: Buffer | string) => {
      const key = parseKey(chunk.toString());
      switch (key.action) {
        case 'confirm':
          cleanup();
          resolve(Array.from(state.selected));
          return;
        case 'cancel':
          cleanup();
          resolve(null);
          return;
        case 'clearOrCancel':
          if (state.filter) { state = { ...state, filter: '', cursor: 0 }; break; }
          cleanup();
          resolve(null);
          return;
        case 'up': state = pickerReducer(state, { type: 'up' }); break;
        case 'down': state = pickerReducer(state, { type: 'down' }); break;
        case 'toggle': state = pickerReducer(state, { type: 'toggle' }); break;
        case 'toggleAll': state = pickerReducer(state, { type: 'toggleAll' }); break;
        case 'backspace': state = pickerReducer(state, { type: 'backspace' }); break;
        case 'char': state = pickerReducer(state, { type: 'filterChar', char: key.char }); break;
        case 'none': return; // ignore, no redraw
      }
      draw();
    };

    try { io.input.setRawMode?.(true); } catch { /* best-effort: degrade if raw mode unsupported */ }
    io.input.resume?.();
    (io.input as any).setEncoding?.('utf8');
    io.output.write('\x1b[?25l'); // hide cursor
    io.input.on('data', onData);
    draw();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/ui/picker-shell.test.ts`
Expected: PASS (3 cases). If a promise hangs, confirm the fake `input.on`/`emit` wiring matches `EventEmitter`.

- [ ] **Step 5: Manual smoke test in a real terminal**

```bash
npm run build && node -e "require('./dist/src/ui/picker').multiselectPicker({title:'demo',items:[{value:'a',label:'alpha',description:'first item '.repeat(20)},{value:'b',label:'beta',description:'second'}]}).then(r=>console.log('picked',r))"
```
Expected: arrows move, space toggles, typing filters, Enter prints the picked values, terminal is left clean (cursor visible, prompt normal).

- [ ] **Step 6: Commit**

```bash
git add src/ui/picker.ts tests/ui/picker-shell.test.ts
git commit -m "feat(ui): interactive multiselect shell with inline redraw and guaranteed restore"
```

---

## Task 6: Width-aware static list + picker-item builders (`src/utils/registry-view.ts`)

**Files:**
- Modify: `src/utils/registry-view.ts`
- Modify: `tests/utils/registry-view.test.ts`

This makes `awm list` width-aware and adds `PickerItem` builders. It **removes** the now-dead clack option builders `buildLevel1Options`/`buildLevel2Options` and their tests (the picker replaces them). `ALL_SENTINEL`, `artifactValue`, and `resolveLevel2Selection` stay.

- [ ] **Step 1: Write the failing tests**

Add to `tests/utils/registry-view.test.ts` (update the import line to add `packagePickerItems`, `artifactPickerItems`, and drop `buildLevel1Options`, `buildLevel2Options`):

```ts
import { packagePickerItems, artifactPickerItems } from '../../src/utils/registry-view';

describe('packageSummaryLines width-awareness', () => {
  it('truncates the description column when a width is given', () => {
    const view = buildPackageView([skill('brainstorming', 'x'.repeat(200))], [], [], [
      bundle({ name: 'core-dev', description: 'Dev lifecycle', skills: [{ name: 'brainstorming', onSignal: false }] }),
    ]);
    const lines = packageSummaryLines(view, 60);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(60);
    expect(lines.some((l) => l.includes('…'))).toBe(true);
  });
  it('does not truncate when no width is given (piped output)', () => {
    const view = buildPackageView([skill('brainstorming', 'y'.repeat(200))], [], [], [
      bundle({ name: 'core-dev', description: 'z'.repeat(200), skills: [{ name: 'brainstorming', onSignal: false }] }),
    ]);
    const lines = packageSummaryLines(view); // no width
    expect(lines.some((l) => l.includes('z'.repeat(200)))).toBe(true);
  });
});

describe('artifactPickerItems', () => {
  it('prepends an "install entire package" sentinel item, then one per artifact', () => {
    const view = buildPackageView([skill('a', 'desc a'), skill('b', 'desc b')], [], [], [
      bundle({ name: 'p', description: 'pkg', skills: [{ name: 'a', onSignal: false }, { name: 'b', onSignal: false }] }),
    ]);
    const items = artifactPickerItems(view.find((p) => p.name === 'p')!);
    expect(items[0].value).toBe(ALL_SENTINEL);
    expect(items.slice(1).map((i) => i.label)).toEqual(['a', 'b']);
    expect(items.find((i) => i.label === 'a')!.description).toBe('desc a');
  });
});

describe('packagePickerItems', () => {
  it('builds one item per package with a count+description summary', () => {
    const view = buildPackageView([skill('a')], [], [], [
      bundle({ name: 'p', description: 'pkg desc', skills: [{ name: 'a', onSignal: false }] }),
    ]);
    const items = packagePickerItems(view);
    expect(items[0].value).toBe('p');
    expect(items[0].description).toContain('pkg desc');
  });
});
```

Also **delete** the existing `describe('buildLevel1Options'...)` and `describe('buildLevel2Options'...)` blocks if present in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/utils/registry-view.test.ts`
Expected: FAIL — `packagePickerItems`/`artifactPickerItems` not exported; width param not honored.

- [ ] **Step 3: Edit `src/utils/registry-view.ts`**

Add the import at the top:

```ts
import { truncate } from '../ui/text';
import { PickerItem } from '../ui/picker-view';
```

Replace `packageSummaryLines` with the width-aware version:

```ts
export function packageSummaryLines(packages: PackageView[], width?: number): string[] {
    const uniqueSkillNames = new Set(packages.flatMap((p) => p.artifacts.filter((a) => a.type === 'skill').map((a) => a.name)));
    const totalSkills = uniqueSkillNames.size;
    const lines: string[] = [`AWM Registry — ${plural(packages.length, 'package')}, ${plural(totalSkills, 'skill')}`, ''];

    const nameWidth = Math.max(0, ...packages.map((p) => p.name.length));
    const countLabels = packages.map((p) => (p.isStandalone ? plural(p.artifacts.length, 'artifact') : artifactCountLabel(p.counts)));
    const countWidth = Math.max(0, ...countLabels.map((c) => c.length));

    packages.forEach((p, i) => {
        const name = p.name.padEnd(nameWidth);
        const count = countLabels[i].padEnd(countWidth);
        let desc = p.isStandalone ? '' : p.description;
        if (width && desc) {
            const used = 2 + nameWidth + 3 + countWidth + 3; // icon+space, name, gap, count, gap
            const avail = width - used;
            desc = avail > 1 ? truncate(desc, avail) : '';
        }
        lines.push(`${packageIcon(p)} ${name}   ${count}   ${desc}`.trimEnd());
    });
    return lines;
}
```

Make `packageDetailLines` width-aware (truncate each description line when a width is given):

```ts
export function packageDetailLines(pkg: PackageView, width?: number): string[] {
    const lines: string[] = [];
    const header = pkg.isStandalone
        ? `${packageIcon(pkg)} ${pkg.name} — ${plural(pkg.artifacts.length, 'artifact')}`
        : `${packageIcon(pkg)} ${pkg.name} — ${pkg.description}  [${artifactCountLabel(pkg.counts)}]`;
    lines.push(header);
    pkg.artifacts.forEach((a) => {
        const mark = a.overrode
            ? pc.yellow(`  ← ${registryNameForPath(a.sourcePath) ?? 'unknown'} (override)`)
            : '';
        lines.push(`  ${TYPE_ICON[a.type]}${a.name}${mark}`);
        if (a.description) {
            const desc = width ? truncate(a.description, width - 5) : a.description;
            lines.push(`     ${desc}`);
        }
    });
    return lines;
}
```

Replace `buildLevel1Options`/`buildLevel2Options` with the picker-item builders (keep `ALL_SENTINEL`, `artifactValue`, `resolveLevel2Selection`):

```ts
export function packagePickerItems(packages: PackageView[]): PickerItem[] {
    return packages.map((p) => ({
        value: p.name,
        label: `${packageIcon(p)} ${p.name}`,
        description: p.isStandalone
            ? plural(p.artifacts.length, 'artifact')
            : `${artifactCountLabel(p.counts)} · ${p.description}`,
    }));
}

export function artifactPickerItems(pkg: PackageView): PickerItem[] {
    const all: PickerItem = {
        value: ALL_SENTINEL,
        label: `✨ Install entire package (${pkg.artifacts.length})`,
        description: 'Select every artifact in this package.',
    };
    const rest: PickerItem[] = pkg.artifacts.map((a) => ({
        value: artifactValue(a),
        label: `${TYPE_ICON[a.type]}${a.name}`,
        description: a.description || '(no description)',
    }));
    return [all, ...rest];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/utils/registry-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/registry-view.ts tests/utils/registry-view.test.ts
git commit -m "feat(list): width-aware static renderers + picker-item builders; drop clack option builders"
```

---

## Task 7: Wire `awm list` and `awm add` (`src/index.ts`)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update imports**

At the top of `src/index.ts`, update the registry-view import to drop the removed builders and add the new ones, and import the UI modules:

```ts
import {
  buildPackageView, packageSummaryLines, packageDetailLines, findPackage,
  packagePickerItems, artifactPickerItems, resolveLevel2Selection,
  ALL_SENTINEL, ArtifactView, artifactValue,
} from './utils/registry-view';
import { isInteractive } from './ui/tty';
import { multiselectPicker } from './ui/picker';
```

- [ ] **Step 2: Make `awm list` width-aware**

In the `list` command action, compute the width once and pass it to every renderer call (the three call sites at the current `packageDetailLines(...)` / `packageSummaryLines(...)` usages):

```ts
const listWidth = process.stdout.isTTY ? process.stdout.columns : undefined;
```

- Single-package detail: `for (const line of packageDetailLines(match, listWidth)) console.log(line);`
- `--all` loop: `for (const line of packageDetailLines(pkg, listWidth)) console.log(line);`
- Default summary: `for (const line of packageSummaryLines(view, listWidth)) console.log(line);`

- [ ] **Step 3: Add the non-interactive guard to `awm add`**

Immediately after artifact discovery (right after the block that exits when no artifacts are found, before "3. Agent & Scope Prompts"), insert:

```ts
// Interactive selection requires a TTY. Bundle-by-name (handled above) works headless.
if (!isInteractive()) {
  console.error(pc.red('`awm add` needs an interactive terminal for selection.'));
  console.error(pc.dim('Install a bundle non-interactively: `awm add <bundle>` (optionally with --agent/--scope).'));
  process.exit(1);
}
```

- [ ] **Step 4: Replace the Level-1 package multiselect**

Replace the `const pkgChoice = await multiselect({...})` block (and its `handleCancel` + mapping) with the picker:

```ts
// 5. Level 1 — pick package(s)
const pickedPackages = await multiselectPicker({
  title: 'Select package(s)',
  items: packagePickerItems(view),
});
if (pickedPackages === null) { outro('Operation cancelled.'); process.exit(0); }
if (pickedPackages.length === 0) { outro(pc.yellow('No packages selected.')); return; }
const selectedPackages = pickedPackages
  .map((name) => view.find((p) => p.name === name)!)
  .filter(Boolean);
```

- [ ] **Step 5: Replace the Level-2 artifact multiselect**

Replace the `const skillChoice = await multiselect({...})` block inside the per-package loop with:

```ts
const picked = await multiselectPicker({
  title: `[${i + 1}/${selectedPackages.length}] ${pkg.name} — select artifacts`,
  items: artifactPickerItems(pkg),
  initialSelected: [ALL_SENTINEL, ...pkg.artifacts.map((a) => artifactValue(a))],
});
if (picked === null) { outro('Operation cancelled.'); process.exit(0); }
for (const a of resolveLevel2Selection(pkg, picked)) {
  dedup.set(artifactValue(a), a);
}
```

> The `initialSelected` seeds "entire package" pre-checked, preserving the old `initialValues: [ALL_SENTINEL]` default behavior (all artifacts selected up front).

- [ ] **Step 6: Build and run the full suite**

```bash
npm run build
npm test
```
Expected: build clean (tsc), all tests green. Fix any type errors from the removed builders (there should be none outside `index.ts` and the registry-view test).

- [ ] **Step 7: Manual verification in a real terminal**

```bash
node dist/src/index.js list
node dist/src/index.js list --all
node dist/src/index.js list | cat        # non-TTY: descriptions not truncated, alignment intact
node dist/src/index.js add               # interactive: two-pane picker, filter, space, tab, enter
node dist/src/index.js add | cat         # non-TTY: clean error guiding to `awm add <bundle>`
```
Expected:
- `list`: columns aligned, long descriptions end with `…`, nothing wraps mid-column.
- `list | cat`: full untruncated descriptions, stable output.
- `add`: legible two-pane selection; typing filters; Tab toggles all; Enter installs.
- `add | cat`: exits 1 with the guidance message; no hang.

- [ ] **Step 8: Run sensors**

```bash
awm sensors run
```
Expected: clean (no new findings). Fix any lint/type findings before completing.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts
git commit -m "feat(add,list): wire two-pane picker and width-aware list with non-interactive fallback"
```

---

## Self-Review (completed during planning)

**1. Spec coverage:**
- §4.1 components → Tasks 1 (`text.ts`), 2 (`tty.ts`), 3 (`picker-view.ts`), 4–5 (`picker.ts`), 6 (`registry-view.ts`), 7 (`index.ts`). ✅
- §5 interaction (inline redraw, keys, adaptive layout, viewport scroll) → Tasks 3 (layout/scroll) + 5 (redraw/keys). ✅ (key model refined; see top note)
- §6 garantía 1 (width-aware list) → Task 6 + Task 7 step 2. ✅
- §6 garantía 2 (no full-screen) → Task 5 inline redraw. ✅
- §6 garantía 3 (non-interactive fallback) → Task 2 (`isInteractive`) + Task 7 step 3. ✅
- §7 restauración de terminal → Task 5 `cleanup()`/`finally`-equivalent + tests. ✅
- §8 testing por capa → tests in Tasks 1–6. ✅

**2. Placeholder scan:** No TBD/TODO; all code blocks complete. The one flagged leftover (`left` local in `renderPicker`) carries an explicit instruction to delete it. ✅

**3. Type consistency:** `PickerItem`/`PickerState` defined in `picker-view.ts` and imported everywhere; `ALL_SENTINEL` exported from both `picker.ts` (re-used) and `registry-view.ts` (original) with the same `'__ALL__'` value — confirm a single source of truth at implementation time: **`picker.ts` should import `ALL_SENTINEL` from `registry-view.ts` rather than redeclare it.** Adjust Task 4 to `import { ALL_SENTINEL } from '../utils/registry-view'` and re-export, to avoid two declarations drifting.

---

## Notes for the implementer

- **Single source for `ALL_SENTINEL`:** keep the original in `registry-view.ts`; in `picker.ts` do `import { ALL_SENTINEL } from '../utils/registry-view'; export { ALL_SENTINEL };`. (Resolves the Type-consistency note above.)
- **AGENTS.md patterns that apply:** `stub-process-platform` (use `Object.defineProperty(..., { configurable: true })` for `isTTY`/`columns` stubs and restore in `afterEach`); `default-arg-seam` / `injected-logger` (the `io` parameter of `multiselectPicker`); `best-effort-catch-comment` (the raw-mode `try/catch` blocks already carry the explanatory comment).
- **No new dependency.** Everything uses Node built-ins + `picocolors`.
- **`@clack/prompts` stays** for `intro`/`outro`/`spinner`/`confirm`/`select` and the agent/scope short selectors — out of scope for this engine.
