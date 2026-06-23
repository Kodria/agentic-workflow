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
    expect(s.selected.has(ALL_SENTINEL)).toBe(true);
  });
  it('toggleAll via Tab syncs ALL_SENTINEL when all become selected', () => {
    const s = pickerReducer(base(), { type: 'toggleAll' });
    expect(s.selected.has('skill:a')).toBe(true);
    expect(s.selected.has('skill:b')).toBe(true);
    expect(s.selected.has(ALL_SENTINEL)).toBe(true);
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
  it('toggling an individual item off removes ALL_SENTINEL from selected', () => {
    // Start with all items pre-selected (the initialSelected scenario)
    const all = new Set([ALL_SENTINEL, 'skill:a', 'skill:b']);
    const s = pickerReducer(base({ cursor: 1, selected: all }), { type: 'toggle' });
    // Unchecked skill:a — sentinel should be gone
    expect(s.selected.has('skill:a')).toBe(false);
    expect(s.selected.has(ALL_SENTINEL)).toBe(false);
    expect(s.selected.has('skill:b')).toBe(true);
  });
  it('toggling the last missing item on syncs the ALL_SENTINEL', () => {
    // skill:a is missing, skill:b is selected — select skill:a and sentinel should appear
    const partial = new Set(['skill:b']);
    const s = pickerReducer(base({ cursor: 1, selected: partial }), { type: 'toggle' });
    expect(s.selected.has('skill:a')).toBe(true);
    expect(s.selected.has(ALL_SENTINEL)).toBe(true);
  });
  it('toggleAll with active filter only toggles visible items', () => {
    // filter to 'beta' — only skill:b is visible (ALL_SENTINEL label '✨ Install entire package (2)' does not match)
    const s = pickerReducer(base({ filter: 'beta' }), { type: 'toggleAll' });
    expect(s.selected.has('skill:b')).toBe(true);
    expect(s.selected.has('skill:a')).toBe(false); // not visible, should NOT be selected
  });
});
