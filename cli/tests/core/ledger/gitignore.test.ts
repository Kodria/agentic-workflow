import fs from 'fs';
import path from 'path';

test('.awm (and therefore .awm/ledger) is gitignored — raw ledger never committed', () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '../../../../.gitignore'), 'utf-8');
    const lines = gitignore.split('\n').map(l => l.trim());
    // D-024: managed block uses `.awm/*` (with allowlist exceptions), not a bare `.awm` / `.awm/`.
    const coversAwm =
        lines.includes('.awm/*') ||
        lines.includes('.awm') ||
        lines.includes('.awm/') ||
        lines.includes('.awm/ledger') ||
        lines.includes('.awm/ledger/');
    expect(coversAwm).toBe(true);
});
