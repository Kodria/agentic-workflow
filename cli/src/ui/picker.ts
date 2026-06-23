import { PickerState, visibleItems, renderPicker, PickerItem } from './picker-view';
import { ALL_SENTINEL as _ALL } from '../utils/registry-view';

// ALL_SENTINEL: single source of truth lives in registry-view.ts — re-exported here.
export const ALL_SENTINEL = _ALL;

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
    case '\x03': return { action: 'cancel' };        // Ctrl-C
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
        if (allSel) {
          reals.forEach((v) => selected.delete(v));
          selected.delete(ALL_SENTINEL);
        } else {
          reals.forEach((v) => selected.add(v));
          selected.add(ALL_SENTINEL);
        }
      } else {
        if (selected.has(item.value)) {
          selected.delete(item.value);
          selected.delete(ALL_SENTINEL); // no longer all-selected
        } else {
          selected.add(item.value);
          // if every real item is now selected, also mark the sentinel
          const reals = realValues(state);
          if (reals.every((v) => selected.has(v))) selected.add(ALL_SENTINEL);
        }
      }
      return { ...state, selected };
    }
    case 'toggleAll': {
      const reals = realValues(state);
      const selected = new Set(state.selected);
      const allSel = reals.every((v) => selected.has(v));
      if (allSel) {
        reals.forEach((v) => selected.delete(v));
        selected.delete(ALL_SENTINEL);
      } else {
        reals.forEach((v) => selected.add(v));
        selected.add(ALL_SENTINEL);
      }
      return { ...state, selected };
    }
    case 'filterChar':
      return { ...state, filter: state.filter + key.char, cursor: 0 };
    case 'backspace':
      return { ...state, filter: state.filter.slice(0, -1), cursor: 0 };
  }
}

// --- Interactive shell ---

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
