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
