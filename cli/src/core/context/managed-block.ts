export const AWM_START = '<!-- AWM:START -->';
export const AWM_END = '<!-- AWM:END -->';

type Block = {
    start: number;
    end: number;
};

function assertText(value: unknown, name: string): asserts value is string {
    if (typeof value !== 'string') throw new Error(`${name} must be a string`);
}

function markerOffsets(input: string, marker: string): number[] {
    const offsets: number[] = [];
    let offset = input.indexOf(marker);
    while (offset !== -1) {
        offsets.push(offset);
        offset = input.indexOf(marker, offset + marker.length);
    }
    return offsets;
}

function inspect(input: string): Block | null {
    const comments = input.match(/<!--[\s\S]*?-->/g) ?? [];
    const malformed = comments.some((comment) =>
        (comment.includes('AWM:START') || comment.includes('AWM:END')) &&
        comment !== AWM_START &&
        comment !== AWM_END,
    );
    if (malformed) throw new Error('malformed AWM marker');

    const starts = markerOffsets(input, AWM_START);
    const ends = markerOffsets(input, AWM_END);
    if (starts.length === 0 && ends.length === 0) return null;
    if (starts.length !== ends.length) throw new Error('unmatched AWM marker');
    if (ends[0] < starts[0]) throw new Error('reversed AWM markers');
    if (starts.length > 1) {
        if (starts[1] < ends[0]) throw new Error('nested AWM markers');
        throw new Error('duplicate AWM blocks');
    }
    return { start: starts[0], end: ends[0] };
}

export function normalizeManagedBody(body: string): string {
    assertText(body, 'body');
    const normalized = body.replace(/(?:\r?\n)+$/u, '');
    if (normalized.length === 0) throw new Error('body must be non-empty');
    if (inspect(normalized)) throw new Error('body must not contain AWM markers');
    return normalized;
}

export function managedBlockBody(original: string): string | null {
    assertText(original, 'original');
    const block = inspect(original);
    if (!block) return null;

    let body = original.slice(block.start + AWM_START.length, block.end);
    if (body.startsWith('\n')) body = body.slice(1);
    if (body.endsWith('\n')) body = body.slice(0, -1);
    return body;
}

export function mergeManagedBlock(original: string, managedBody: string): string {
    assertText(original, 'original');
    const body = normalizeManagedBody(managedBody);
    const block = inspect(original);
    const rendered = `${AWM_START}\n${body}\n${AWM_END}`;

    if (block) {
        return original.slice(0, block.start) + rendered + original.slice(block.end + AWM_END.length);
    }

    const separator = original.length === 0
        ? ''
        : original.endsWith('\n\n')
            ? ''
            : original.endsWith('\n') ? '\n' : '\n\n';
    return `${original}${separator}${rendered}\n`;
}

export function removeManagedBlock(original: string): string {
    assertText(original, 'original');
    const block = inspect(original);
    if (!block) return original;
    return original.slice(0, block.start) + original.slice(block.end + AWM_END.length);
}
