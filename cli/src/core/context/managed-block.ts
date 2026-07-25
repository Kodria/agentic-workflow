export const AWM_START = '<!-- AWM:START -->';
export const AWM_END = '<!-- AWM:END -->';

type Boundary = {
    prefix: number;
    suffix: number;
};

type Block = {
    start: number;
    end: number;
};

const BOUNDARY_PATTERN = /^<!-- AWM:BOUNDARY prefix=([0-2]) suffix=([0-1]) -->\n/u;

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

function insideMarkdownFence(input: string, offset: number): boolean {
    let fence: { character: string; length: number } | null = null;
    for (const line of input.slice(0, offset).split(/\r?\n/u)) {
        const match = line.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/u);
        if (!match) continue;
        const run = match[1];
        if (!fence) {
            fence = { character: run[0], length: run.length };
        } else if (
            run[0] === fence.character &&
            run.length >= fence.length &&
            match[2].trim().length === 0
        ) {
            fence = null;
        }
    }
    return fence !== null;
}

function validateMarkerOccurrences(input: string, prefix: string, marker: string): void {
    let offset = input.indexOf(prefix);
    while (offset !== -1) {
        if (!input.startsWith(marker, offset)) {
            if (input.indexOf('-->', offset + prefix.length) === -1) {
                throw new Error('incomplete AWM marker');
            }
            throw new Error('malformed AWM marker');
        }

        const after = offset + marker.length;
        const startsLine = offset === 0 || input[offset - 1] === '\n';
        const endsLine = after === input.length ||
            input[after] === '\n' ||
            (input[after] === '\r' && input[after + 1] === '\n');
        if (!startsLine || !endsLine) {
            throw new Error('AWM markers must be standalone delimiter lines');
        }
        if (insideMarkdownFence(input, offset)) {
            throw new Error('AWM markers must be standalone delimiter lines outside code fences');
        }
        offset = input.indexOf(prefix, offset + prefix.length);
    }
}

function inspect(input: string): Block | null {
    validateMarkerOccurrences(input, '<!-- AWM:START', AWM_START);
    validateMarkerOccurrences(input, '<!-- AWM:END', AWM_END);

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

function stripDelimiterNewlines(value: string): string {
    let result = value;
    if (result.startsWith('\r\n')) result = result.slice(2);
    else if (result.startsWith('\n')) result = result.slice(1);
    if (result.endsWith('\r\n')) result = result.slice(0, -2);
    else if (result.endsWith('\n')) result = result.slice(0, -1);
    return result;
}

function contentOf(original: string, block: Block): { body: string; boundary: Boundary | null } {
    let content = stripDelimiterNewlines(
        original.slice(block.start + AWM_START.length, block.end),
    );
    const boundaryMatch = content.match(BOUNDARY_PATTERN);
    if (!boundaryMatch) return { body: content, boundary: null };

    content = content.slice(boundaryMatch[0].length);
    return {
        body: content,
        boundary: {
            prefix: Number(boundaryMatch[1]),
            suffix: Number(boundaryMatch[2]),
        },
    };
}

function render(body: string, boundary: Boundary | null): string {
    const metadata = boundary
        ? `<!-- AWM:BOUNDARY prefix=${boundary.prefix} suffix=${boundary.suffix} -->\n`
        : '';
    return `${AWM_START}\n${metadata}${body}\n${AWM_END}`;
}

export function normalizeManagedBody(body: string): string {
    assertText(body, 'body');
    const normalized = body.replace(/(?:\r?\n)+$/u, '');
    if (normalized.length === 0) throw new Error('body must be non-empty');
    if (normalized.includes('<!-- AWM:BOUNDARY')) {
        throw new Error('body must not contain AWM boundary metadata');
    }
    if (inspect(normalized)) throw new Error('body must not contain AWM markers');
    return normalized;
}

export function managedBlockBody(original: string): string | null {
    assertText(original, 'original');
    const block = inspect(original);
    if (!block) return null;
    return contentOf(original, block).body;
}

export function mergeManagedBlock(original: string, managedBody: string): string {
    assertText(original, 'original');
    const body = normalizeManagedBody(managedBody);
    const block = inspect(original);

    if (block) {
        const rendered = render(body, contentOf(original, block).boundary);
        return original.slice(0, block.start) + rendered + original.slice(block.end + AWM_END.length);
    }

    const separator = original.length === 0
        ? ''
        : original.endsWith('\n\n')
            ? ''
            : original.endsWith('\n') ? '\n' : '\n\n';
    const boundary = { prefix: separator.length, suffix: 1 };
    return `${original}${separator}${render(body, boundary)}\n`;
}

export function removeManagedBlock(original: string): string {
    assertText(original, 'original');
    const block = inspect(original);
    if (!block) return original;

    const boundary = contentOf(original, block).boundary;
    let ownedStart = block.start;
    let ownedEnd = block.end + AWM_END.length;
    if (boundary) {
        const prefix = '\n'.repeat(boundary.prefix);
        const suffix = '\n'.repeat(boundary.suffix);
        if (original.slice(block.start - prefix.length, block.start) === prefix) {
            ownedStart -= prefix.length;
        }
        if (original.slice(ownedEnd, ownedEnd + suffix.length) === suffix) {
            ownedEnd += suffix.length;
        }
    }
    return original.slice(0, ownedStart) + original.slice(ownedEnd);
}
