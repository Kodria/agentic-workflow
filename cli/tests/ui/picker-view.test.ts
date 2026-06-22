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
