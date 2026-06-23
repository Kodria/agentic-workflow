const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
    (cp >= 0x2300 && cp <= 0x23ff) ||   // misc technical (⏎ etc.)
    (cp >= 0x2600 && cp <= 0x27bf) ||   // misc symbols / dingbats
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified Ideographs
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul Syllables
    (cp >= 0xff00 && cp <= 0xffef) ||   // Fullwidth Latin/symbols
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
