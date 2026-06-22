import { PickerState, visibleItems } from './picker-view';
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
        if (selected.has(item.value)) selected.delete(item.value);
        else selected.add(item.value);
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
      }
      return { ...state, selected };
    }
    case 'filterChar':
      return { ...state, filter: state.filter + key.char, cursor: 0 };
    case 'backspace':
      return { ...state, filter: state.filter.slice(0, -1), cursor: 0 };
  }
}
