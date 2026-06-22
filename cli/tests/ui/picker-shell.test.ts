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

it('Esc with empty filter cancels and returns null', async () => {
  const { io, send } = fakeIO();
  const p = multiselectPicker({ title: 't', items }, io);
  send('\x1b');  // Esc with no active filter → cancel
  await expect(p).resolves.toBeNull();
  expect(io.input.setRawMode).toHaveBeenLastCalledWith(false);
});

it('Esc with active filter clears it instead of cancelling', async () => {
  const { io, send } = fakeIO();
  const p = multiselectPicker({ title: 't', items }, io);
  send('a');     // type 'a' → filter becomes 'a'
  send('\x1b');  // Esc → should clear filter, NOT cancel
  send('\r');    // Enter → confirm (with no selection)
  await expect(p).resolves.toEqual([]);
  // setRawMode(false) called on confirm, not on Esc
  expect(io.input.setRawMode).toHaveBeenLastCalledWith(false);
});
