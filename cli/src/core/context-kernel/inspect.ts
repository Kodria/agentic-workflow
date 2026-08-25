import fs from 'fs';
import path from 'path';
import type { ContextEntryV1, ContextIndexV1, ContextKernelInspection, ContextTier } from './types';

const INDEX_PATH = ['.awm', 'context', 'index.json'];
const ROOT_CONTEXT_FILES = ['AGENTS.md', 'CONSTITUTION.md', 'CLAUDE.md'];
const START_MARKER = '<!-- AWM:CONTEXT-KERNEL:START v1 -->';
const END_MARKER = '<!-- AWM:CONTEXT-KERNEL:END v1 -->';
const TOP_LEVEL_FIELDS = ['schema', 'kernelFiles', 'maxFixedBytes', 'entries'];
const ENTRY_FIELDS = ['id', 'tier', 'path', 'anchor', 'when'];
const REMEDY = 'run project-context-init and review the Context Kernel v1 artifacts';

function invalid(detail: string): ContextKernelInspection {
    return { state: 'invalid', detail, remedy: REMEDY };
}

function within(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function count(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

function exactFields(raw: Record<string, unknown>, fields: string[]): boolean {
    const keys = Object.keys(raw);
    return keys.length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(raw, field));
}

function isNormalizedRelative(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
    if (value.includes('\\') || value.split('/').some((part) => part === '.' || part === '..' || part === '')) return false;
    return path.posix.normalize(value) === value;
}

function resolveRegularInside(root: string, relative: unknown): { file?: string; detail?: string } {
    if (!isNormalizedRelative(relative)) return { detail: `invalid repository-relative path ${JSON.stringify(relative)}` };
    const candidate = path.join(root, relative);
    try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) return { detail: `${relative} must resolve to a regular file` };
        const real = fs.realpathSync(candidate);
        if (!within(root, real)) return { detail: `${relative} resolves outside the project root` };
        return { file: real };
    } catch (error) {
        return { detail: `${relative} cannot be read: ${error instanceof Error ? error.message : String(error)}` };
    }
}

function parseEntry(raw: unknown): { entry?: ContextEntryV1; detail?: string } {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !exactFields(raw as Record<string, unknown>, ENTRY_FIELDS)) {
        return { detail: 'each index entry must contain exactly id, tier, path, anchor, when' };
    }
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== 'string' || !/^CTX-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value.id) || Buffer.byteLength(value.id, 'utf8') > 80) {
        return { detail: 'entry id must match CTX-[A-Z0-9-]+ and be at most 80 bytes' };
    }
    if (value.tier !== 'kernel' && value.tier !== 'selective') return { detail: 'entry tier must be kernel or selective' };
    if (!isNormalizedRelative(value.path)) return { detail: `invalid repository-relative path ${JSON.stringify(value.path)}` };
    for (const field of ['anchor', 'when']) {
        if (typeof value[field] !== 'string' || value[field].length === 0 || Buffer.byteLength(value[field], 'utf8') > 500) {
            return { detail: `entry ${field} must be a non-empty string of at most 500 bytes` };
        }
    }
    return { entry: { id: value.id, tier: value.tier as ContextTier, path: value.path, anchor: value.anchor as string, when: value.when as string } };
}

function parseIndex(contents: string): { index?: ContextIndexV1; detail?: string } {
    let raw: unknown;
    try { raw = JSON.parse(contents); } catch (error) { return { detail: `index is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !exactFields(raw as Record<string, unknown>, TOP_LEVEL_FIELDS)) {
        return { detail: 'index must contain exactly schema, kernelFiles, maxFixedBytes, entries' };
    }
    const value = raw as Record<string, unknown>;
    if (value.schema !== 1 || !Number.isSafeInteger(value.schema)) return { detail: 'index schema must be exactly 1' };
    if (!Array.isArray(value.kernelFiles) || value.kernelFiles.length === 0 || value.kernelFiles.some((file) => !isNormalizedRelative(file)) || new Set(value.kernelFiles).size !== value.kernelFiles.length) {
        return { detail: 'kernelFiles must be a non-empty unique normalized path array' };
    }
    if ((value.kernelFiles as string[]).some((file) => file.includes('/'))) return { detail: 'kernelFiles must name root context files' };
    if (!Number.isSafeInteger(value.maxFixedBytes) || (value.maxFixedBytes as number) < 1) return { detail: 'maxFixedBytes must be a positive integer' };
    if (!Array.isArray(value.entries) || value.entries.length === 0) return { detail: 'entries must be a non-empty array' };
    const entries: ContextEntryV1[] = [];
    for (const rawEntry of value.entries) {
        const parsed = parseEntry(rawEntry);
        if (!parsed.entry) return { detail: parsed.detail };
        entries.push(parsed.entry);
    }
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return { detail: 'entry ids must be unique' };
    if (new Set(entries.map((entry) => entry.anchor)).size !== entries.length) return { detail: 'entry anchors must be unique' };
    return { index: { schema: 1, kernelFiles: value.kernelFiles as string[], maxFixedBytes: value.maxFixedBytes as number, entries } };
}

function markerBounds(contents: string): { start: number; end: number } | null {
    if (count(contents, START_MARKER) !== 1 || count(contents, END_MARKER) !== 1) return null;
    const start = contents.indexOf(START_MARKER) + START_MARKER.length;
    const end = contents.indexOf(END_MARKER);
    return start < end ? { start, end } : null;
}

/** Inspects project-owned Context Kernel v1 artifacts. Invalid project artifacts are
 * classified explicitly; only invalid public input throws. */
export function inspectContextKernel(cwd: string): ContextKernelInspection {
    if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cwd must be a non-empty directory path');
    let root: string;
    try {
        root = fs.realpathSync(cwd);
        if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    } catch (error) {
        throw new Error(`cwd must resolve to an existing directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    const indexFile = path.join(root, ...INDEX_PATH);
    let indexExists: boolean;
    try {
        fs.lstatSync(indexFile);
        indexExists = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return invalid(`${indexFile} cannot be inspected`);
        indexExists = false;
    }
    if (!indexExists) {
        for (const name of ROOT_CONTEXT_FILES) {
            const candidate = path.join(root, name);
            try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && fs.readFileSync(candidate, 'utf8').includes('AWM:CONTEXT-KERNEL:')) {
                    return invalid(`${name} contains Context Kernel markers but ${INDEX_PATH.join('/')} is missing`);
                }
            } catch (error) {
                return invalid(`${name} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return { state: 'legacy' };
    }

    const indexTarget = resolveRegularInside(root, INDEX_PATH.join('/'));
    if (!indexTarget.file) return invalid(`${INDEX_PATH.join('/')}: ${indexTarget.detail}`);
    let parsed: { index?: ContextIndexV1; detail?: string };
    try { parsed = parseIndex(fs.readFileSync(indexTarget.file, 'utf8')); } catch (error) { return invalid(`${INDEX_PATH.join('/')}: cannot be read: ${error instanceof Error ? error.message : String(error)}`); }
    if (!parsed.index) return invalid(`${INDEX_PATH.join('/')}: ${parsed.detail}`);
    const index = parsed.index;

    const files = new Map<string, string>();
    for (const kernelFile of index.kernelFiles) {
        const target = resolveRegularInside(root, kernelFile);
        if (!target.file) return invalid(`${kernelFile}: ${target.detail}`);
        const contents = fs.readFileSync(target.file, 'utf8');
        if (!markerBounds(contents)) return invalid(`${kernelFile}: requires exactly one ordered Context Kernel v1 marker pair`);
        files.set(kernelFile, contents);
    }

    for (const entry of index.entries) {
        const target = resolveRegularInside(root, entry.path);
        if (!target.file) return invalid(`${entry.path}: ${target.detail}`);
        let contents: string;
        try { contents = files.get(entry.path) ?? fs.readFileSync(target.file, 'utf8'); } catch (error) { return invalid(`${entry.path}: cannot be read: ${error instanceof Error ? error.message : String(error)}`); }
        const marker = `<!-- ${entry.anchor} -->`;
        if (count(contents, marker) !== 1) return invalid(`${entry.path}: anchor ${entry.anchor} must appear exactly once`);
        const anchor = contents.indexOf(marker);
        const bounds = files.has(entry.path) ? markerBounds(contents) : null;
        if (entry.tier === 'kernel') {
            if (!files.has(entry.path)) return invalid(`${entry.path}: kernel entry must point to a kernel file`);
            if (!bounds || anchor < bounds.start || anchor >= bounds.end) return invalid(`${entry.path}: kernel anchor ${entry.anchor} must be inside the protected region`);
        } else if (bounds && anchor >= bounds.start && anchor < bounds.end) {
            return invalid(`${entry.path}: selective anchor ${entry.anchor} must be outside the protected region`);
        }
    }

    let fixedBytes = 0;
    for (const name of ROOT_CONTEXT_FILES) {
        const candidate = path.join(root, name);
        if (!fs.existsSync(candidate)) continue;
        const target = resolveRegularInside(root, name);
        if (!target.file) return invalid(`${name}: ${target.detail}`);
        fixedBytes += fs.statSync(target.file).size;
    }
    if (fixedBytes > index.maxFixedBytes) return invalid(`fixed context bytes ${fixedBytes} exceed maxFixedBytes ${index.maxFixedBytes}`);
    return { state: 'valid', schema: 1, index, fixedBytes };
}
