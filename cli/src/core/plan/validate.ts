import fs from 'fs';
import path from 'path';
import { parseJsonNoDuplicate } from './json';
import type { CompactPlanManifest, PlanDiagnostic, PlanSlice, PlanValidationReport } from './types';

const START = '<!-- AWM:COMPACT-SLICES:START v1 -->';
const END = '<!-- AWM:COMPACT-SLICES:END v1 -->';
const MAX_PLAN = 1024 * 1024;
const MAX_MANIFEST = 256 * 1024;
const MAX_SOURCE = 1024 * 1024;
const MAX_STRING = 4096;
const ID = /^[A-Z][A-Z0-9-]{0,63}$/;
const PLAN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHELL = new Set([
    'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'powershell', 'pwsh',
    'env', 'busybox', 'node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'lua',
]);
function isLauncher(program: string): boolean {
    const base = path.posix.basename(program).toLowerCase();
    return SHELL.has(base.replace(/\.exe$/, '')) || /^(?:node(?:js)?|py(?:thon(?:w)?\d*(?:\.\d+)?)?|deno|bun|ruby(?:\d+(?:\.\d+)*)?|perl(?:\d+(?:\.\d+)*)?|(?:a|ba|c|tc|z|da|k)?sh|busybox|cmd|powershell|pwsh|wscript|cscript)(?:\.exe)?(?:[-.][a-z0-9][a-z0-9.-]*)?$/i.test(base);
}

function diagnostic(code: string, message: string, field?: string): PlanValidationReport { return { state: 'invalid', diagnostics: [{ code, message, ...(field ? { field } : {}) }] }; }
function unsupported(schema: string): PlanValidationReport { return { state: 'unsupported', schema, diagnostics: [{ code: 'PLAN_UNSUPPORTED_SCHEMA', message: 'unsupported compact plan schema; update the CLI' }] }; }
function markerlessSchemaClassification(text: string): PlanValidationReport | undefined {
    let candidate: unknown;
    try { candidate = parseJsonNoDuplicate(text.trim()); } catch { return undefined; }
    if (!object(candidate) || !Object.prototype.hasOwnProperty.call(candidate, 'schema')) return undefined;
    if (typeof candidate.schema !== 'string') return diagnostic('PLAN_MARKERS', 'compact markers must occur once in order');
    if (Buffer.byteLength(candidate.schema, 'utf8') > MAX_STRING) return diagnostic('PLAN_LIMIT', 'schema exceeds maximum string size');
    if (candidate.schema.startsWith('compact-slices/') && candidate.schema !== 'compact-slices/v1') return unsupported(candidate.schema);
    return diagnostic('PLAN_MARKERS', 'compact markers must occur once in order');
}
function count(text: string, token: string): number { return text.split(token).length - 1; }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, fields: string[]): value is Record<string, unknown> {
    return object(value) && Object.keys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}
function allStrings(value: unknown, max = MAX_STRING): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string' && Buffer.byteLength(item, 'utf8') <= max); }
function validId(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function inside(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function validRelative(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_STRING && !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes('\\') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..') && path.posix.normalize(value) === value;
}
function regularInside(root: string, relative: string): string | undefined {
    if (!validRelative(relative)) return undefined;
    const candidate = path.join(root, relative); if (!inside(root, candidate)) return undefined;
    const parts = relative.split('/'); let current = root;
    try { for (const part of parts) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) return undefined; } if (!fs.lstatSync(candidate).isFile()) return undefined; const real = fs.realpathSync(candidate); return inside(root, real) ? real : undefined; } catch { return undefined; }
}
function executableInside(root: string, relative: string): string | undefined {
    const file = regularInside(root, relative);
    try { return file && (process.platform === 'win32' ? /\.(?:exe|cmd|bat)$/i.test(file) : (fs.statSync(file).mode & 0o111) !== 0) ? file : undefined; } catch { return undefined; }
}
function refs(value: unknown, known: Set<string>): boolean { return allStrings(value) && value.every((id) => known.has(id)); }
function uniqueRefs(value: unknown, known: Set<string>): boolean { return refs(value, known) && new Set(value as string[]).size === (value as string[]).length; }
function unsafeCommand(value: string): boolean { return /[\0\r\n]|[`$]|\$\(|\$\{|[;&|<>*?\[\]{}()]/.test(value); }
function withoutFencedCode(text: string): string {
    let fence: { character: string; length: number } | undefined;
    return text.split('\n').map((line) => {
        const marker = /^(?: {0,3})(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker && (!fence || (marker[0] === fence.character && marker.length >= fence.length))) {
            fence = fence ? undefined : { character: marker[0], length: marker.length };
            return '';
        }
        return fence ? '' : line;
    }).join('\n');
}
function checkMarkdown(text: string, slices: PlanSlice[]): PlanValidationReport | undefined {
    const markdown = withoutFencedCode(text);
    const headingOffsets = new Set<number>();
    for (const slice of slices) {
    const anchor = `<a id="${slice.sectionAnchor}"></a>`;
        if (count(markdown, anchor) !== 1) return diagnostic('PLAN_MARKDOWN_ANCHOR', 'slice anchor must occur exactly once');
        const start = markdown.indexOf(anchor); const heading = `### Slice ${slice.id}: ${slice.title}`;
    const expectedHeading = start + anchor.length + 1;
        if (markdown[start + anchor.length] !== '\n') return diagnostic('PLAN_MARKDOWN_HEADING', 'slice heading must immediately follow anchor');
        const headingEnd = markdown.indexOf('\n', expectedHeading);
        if (markdown.slice(expectedHeading, headingEnd < 0 ? markdown.length : headingEnd) !== heading) return diagnostic('PLAN_MARKDOWN_HEADING', 'slice heading must exactly match manifest after anchor');
    const headingAt = expectedHeading;
        headingOffsets.add(headingAt);
    }
    for (const match of markdown.matchAll(/^### Slice .*$/gm)) {
        if (!headingOffsets.has(match.index ?? -1)) return diagnostic('PLAN_MARKDOWN_HEADING', 'slice headings must immediately follow declared anchors');
    }
    for (const slice of slices) {
        const anchor = `<a id="${slice.sectionAnchor}"></a>`;
        const start = markdown.indexOf(anchor); const heading = `### Slice ${slice.id}: ${slice.title}`;
        const headingAt = start + anchor.length + 1;
        const next = markdown.indexOf('\n### Slice ', headingAt + heading.length); const end = next < 0 ? markdown.length : next;
        const section = markdown.slice(start, end);
    for (const name of ['Surfaces', 'Implementation', 'Edge cases', 'Evidence', 'Fallback']) {
        if ((section.match(new RegExp(`^#### ${name}\\s*$`, 'gm')) ?? []).length !== 1) return diagnostic('PLAN_MARKDOWN_SECTION', 'each required slice subsection must occur exactly once');
        const match = new RegExp(`^#### ${name}\\s*\\n\\s*([^#\\s][\\s\\S]*?)(?=\\n#### |$)`, 'm').exec(section);
        if (!match || /\b(?:TODO|TBD|placeholder|draft)\b/i.test(match[1])) return diagnostic('PLAN_MARKDOWN_SECTION', 'slice section must contain complete prose');
    }
    }
    return undefined;
}

/** Read-only validator for a bounded compact-slices/v1 Markdown plan. */
export function validatePlanFile(planPath: string, cwd = process.cwd()): PlanValidationReport {
    if (typeof planPath !== 'string' || planPath.length === 0) throw new Error('planPath must be a non-empty path');
    if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cwd must be a non-empty directory path');
    let root: string; try { root = fs.realpathSync(cwd); if (!fs.statSync(root).isDirectory()) throw new Error(); } catch { throw new Error('cwd must resolve to an existing directory'); }
    const candidate = path.resolve(root, planPath); if (!inside(root, candidate)) return diagnostic('PLAN_PATH_UNSAFE', 'plan path must be inside cwd');
    const relativePlan = path.relative(root, candidate); const planFile = regularInside(root, relativePlan);
    if (!planFile) return diagnostic('PLAN_PATH_UNSAFE', 'plan path must be a contained regular non-symlink file');
    let bytes: Buffer; try { if (fs.statSync(planFile).size > MAX_PLAN) return diagnostic('PLAN_LIMIT', 'plan exceeds maximum size'); bytes = fs.readFileSync(planFile); } catch { return diagnostic('PLAN_READ', 'plan cannot be read'); }
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return diagnostic('PLAN_ENCODING', 'plan must be valid UTF-8'); }
    const starts = count(text, START); const ends = count(text, END); const signaled = starts > 0 || ends > 0 || /"schema"\s*:\s*"compact-slices(?:\/|\\u002[fF])/.test(text);
    if (!signaled) return markerlessSchemaClassification(text) ?? { state: 'legacy' };
    if (starts === 0 && ends === 0) { try { const candidate = parseJsonNoDuplicate(text.trim()); if (object(candidate) && typeof candidate.schema === 'string' && Buffer.byteLength(candidate.schema, 'utf8') <= MAX_STRING && candidate.schema.startsWith('compact-slices/') && candidate.schema !== 'compact-slices/v1') return unsupported(candidate.schema); } catch { /* invalid below */ } return diagnostic('PLAN_MARKERS', 'compact markers must occur once in order'); }
    if (starts !== 1 || ends !== 1 || text.indexOf(START) > text.indexOf(END)) { const partial = starts === 1 ? text.slice(text.indexOf(START) + START.length, ends ? text.indexOf(END) : undefined).trim() : ''; try { const candidate = parseJsonNoDuplicate(partial); if (object(candidate) && typeof candidate.schema === 'string' && Buffer.byteLength(candidate.schema, 'utf8') <= MAX_STRING && candidate.schema.startsWith('compact-slices/') && candidate.schema !== 'compact-slices/v1') return unsupported(candidate.schema); } catch { /* invalid below */ } return diagnostic('PLAN_MARKERS', 'compact markers must occur once in order'); }
    const body = text.slice(text.indexOf(START) + START.length, text.indexOf(END)); if (Buffer.byteLength(body, 'utf8') > MAX_MANIFEST) return diagnostic('PLAN_LIMIT', 'manifest exceeds maximum size');
    let raw: unknown; try { raw = parseJsonNoDuplicate(body.trim()); } catch { return diagnostic('PLAN_JSON', 'manifest must be valid JSON without duplicate keys'); }
    if (!object(raw)) return diagnostic('PLAN_SHAPE', 'manifest must be an object');
    if (typeof raw.schema === 'string' && Buffer.byteLength(raw.schema, 'utf8') > MAX_STRING) return diagnostic('PLAN_LIMIT', 'schema exceeds maximum string size');
    if (typeof raw.schema === 'string' && raw.schema.startsWith('compact-slices/') && raw.schema !== 'compact-slices/v1') return unsupported(raw.schema);
    if (!exact(raw, ['schema', 'planId', 'requirements', 'sources', 'commands', 'slices', 'closureCommands'])) return diagnostic(Object.keys(raw).some((key) => !['schema', 'planId', 'requirements', 'sources', 'commands', 'slices', 'closureCommands'].includes(key)) ? 'PLAN_UNKNOWN_FIELD' : 'PLAN_MISSING_FIELD', 'manifest fields must exactly match the contract');
    if (!Array.isArray(raw.requirements) || raw.requirements.length > 256 || !Array.isArray(raw.sources) || raw.sources.length > 256 || !Array.isArray(raw.commands) || raw.commands.length > 512 || !Array.isArray(raw.slices) || raw.slices.length > 64) return diagnostic('PLAN_LIMIT', 'manifest exceeds collection limits');
    if (typeof raw.planId === 'string' && Buffer.byteLength(raw.planId, 'utf8') > MAX_STRING) return diagnostic('PLAN_LIMIT', 'plan id exceeds maximum string size');
    if (raw.schema !== 'compact-slices/v1' || typeof raw.planId !== 'string' || !PLAN_ID.test(raw.planId) || !allStrings(raw.requirements) || new Set(raw.requirements).size !== raw.requirements.length) return diagnostic('PLAN_SHAPE', 'manifest scalar fields are invalid');
    if ((raw.requirements as string[]).some((id) => !ID.test(id)) || !allStrings(raw.closureCommands) || new Set(raw.closureCommands as string[]).size !== (raw.closureCommands as string[]).length) return diagnostic('PLAN_SHAPE', 'manifest arrays or identifiers are invalid');
    const sourceIds = new Set<string>();
    for (const source of raw.sources) { if (!exact(source, ['id', 'path', 'locator', 'fact']) || !validId(source.id) || sourceIds.has(source.id) || !validRelative(source.path) || typeof source.locator !== 'string' || source.locator.trim().length === 0 || /[\0\r\n]/.test(source.locator) || Buffer.byteLength(source.locator, 'utf8') > MAX_STRING || typeof source.fact !== 'string' || source.fact.trim().length === 0 || Buffer.byteLength(source.fact, 'utf8') > MAX_STRING) return diagnostic('PLAN_SOURCE_SHAPE', 'source fields are invalid'); sourceIds.add(source.id); const file = regularInside(root, source.path as string); if (!file) return diagnostic('PLAN_SOURCE_UNSAFE', 'source path must be a contained regular non-symlink file'); let bytes: Buffer; try { if (fs.statSync(file).size > MAX_SOURCE) return diagnostic('PLAN_SOURCE_LIMIT', 'source exceeds maximum size'); bytes = fs.readFileSync(file); } catch { return diagnostic('PLAN_SOURCE_UNSAFE', 'source cannot be read'); } let contents: string; try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return diagnostic('PLAN_SOURCE_ENCODING', 'source must be valid UTF-8'); } if (!contents.includes(source.locator as string)) return diagnostic('PLAN_SOURCE_LOCATOR', 'source locator must occur in source file'); }
    const commandIds = new Set<string>(); const closureIds = new Set(raw.closureCommands as string[]);
    for (const command of raw.commands) { if (!exact(command, ['id', 'program', 'args', 'covers']) || !validId(command.id) || commandIds.has(command.id) || typeof command.program !== 'string' || command.program.length === 0 || Buffer.byteLength(command.program, 'utf8') > MAX_STRING || !allStrings(command.args) || command.args.length > 128 || !allStrings(command.covers) || new Set(command.covers as string[]).size !== (command.covers as string[]).length || ((command.covers as string[]).length === 0 && !closureIds.has(command.id)) || (command.covers as string[]).some((id) => !(raw.requirements as string[]).includes(id))) return diagnostic('PLAN_COMMAND_SHAPE', 'command fields are invalid'); commandIds.add(command.id); const program = command.program as string; if (isLauncher(program) || unsafeCommand(program) || program.includes('\\') || /^[a-zA-Z]:/.test(program) || /\s/.test(program) || (program.includes('/') && !executableInside(root, program))) return diagnostic('PLAN_COMMAND_UNSAFE', 'command program is not inert and safe'); if ((command.args as string[]).some(unsafeCommand)) return diagnostic('PLAN_COMMAND_UNSAFE', 'command arguments contain shell syntax'); }
    const sliceIds = new Set<string>(); const owners = new Map<string, number>();
    for (const slice of raw.slices) { if (!exact(slice, ['id', 'title', 'requirements', 'dependsOn', 'sectionAnchor', 'sources', 'redCommands', 'greenCommands', 'reviewEvidence', 'risk', 'fallback']) || !validId(slice.id) || sliceIds.has(slice.id) || typeof slice.title !== 'string' || slice.title.length === 0 || Buffer.byteLength(slice.title, 'utf8') > MAX_STRING || !allStrings(slice.requirements) || (slice.requirements as string[]).length === 0 || (slice.requirements as string[]).some((id) => !(raw.requirements as string[]).includes(id)) || !allStrings(slice.dependsOn) || typeof slice.sectionAnchor !== 'string' || slice.sectionAnchor.length === 0 || Buffer.byteLength(slice.sectionAnchor, 'utf8') > MAX_STRING || !uniqueRefs(slice.sources, sourceIds) || !uniqueRefs(slice.redCommands, commandIds) || (slice.redCommands as string[]).length === 0 || !uniqueRefs(slice.greenCommands, commandIds) || (slice.greenCommands as string[]).length === 0 || !allStrings(slice.fallback) || (slice.fallback as string[]).length === 0 || (slice.fallback as string[]).some((item) => item.trim().length === 0) || slice.risk !== 'bounded' && slice.risk !== 'full-context') return diagnostic('PLAN_SLICE_SHAPE', 'slice fields are invalid'); sliceIds.add(slice.id); if (!Array.isArray(slice.reviewEvidence) || slice.reviewEvidence.length !== 2 || new Set(slice.reviewEvidence).size !== 2 || !slice.reviewEvidence.includes('specification') || !slice.reviewEvidence.includes('code-quality')) return diagnostic('PLAN_REVIEW_EVIDENCE', 'review evidence must be specification and code-quality'); for (const requirement of slice.requirements as string[]) owners.set(requirement, (owners.get(requirement) ?? 0) + 1); }
    if ((raw.requirements as string[]).some((requirement) => owners.get(requirement) !== 1)) return diagnostic('PLAN_REQUIREMENT_OWNER', 'each requirement must have exactly one owner');
    const slices = raw.slices as PlanSlice[]; for (const slice of slices) { if (new Set(slice.dependsOn).size !== slice.dependsOn.length || slice.dependsOn.includes(slice.id) || !slice.dependsOn.every((id) => sliceIds.has(id))) return diagnostic('PLAN_DEPENDENCY', 'slice dependencies must resolve and be non-self unique'); }
    const visited = new Set<string>(); const visiting = new Set<string>(); const byId = new Map(slices.map((slice) => [slice.id, slice])); const cycle = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const found = byId.get(id)!.dependsOn.some(cycle); visiting.delete(id); visited.add(id); return found; }; if (slices.some((slice) => cycle(slice.id))) return diagnostic('PLAN_DEPENDENCY', 'slice dependencies must be acyclic');
    for (const command of raw.commands as Array<Record<string, unknown>>) { const covers = command.covers as string[]; const references = slices.filter((slice) => slice.redCommands.includes(command.id as string) || slice.greenCommands.includes(command.id as string)); if (covers.length > 0 && !references.some((slice) => covers.some((requirement) => slice.requirements.includes(requirement)))) return diagnostic('PLAN_COMMAND_COVER', 'command coverage must relate to a referencing slice'); }
    for (const slice of slices) { for (const requirement of slice.requirements) { const covered = (raw.commands as Array<Record<string, unknown>>).some((command) => (command.covers as string[]).includes(requirement) && (slice.redCommands.includes(command.id as string) || slice.greenCommands.includes(command.id as string))); if (!covered) return diagnostic('PLAN_REQUIREMENT_COVER', 'each requirement must be covered by a command executed by its owning slice'); } }
    const usedSources = new Set(slices.flatMap((slice) => slice.sources)); const usedCommands = new Set([...slices.flatMap((slice) => [...slice.redCommands, ...slice.greenCommands]), ...(raw.closureCommands as string[])]); if (Array.from(sourceIds).some((id) => !usedSources.has(id)) || Array.from(commandIds).some((id) => !usedCommands.has(id)) || !refs(raw.closureCommands, commandIds)) return diagnostic('PLAN_ORPHAN', 'sources and commands must be referenced');
    const markdown = checkMarkdown(text, slices); if (markdown) return markdown;
    return { state: 'valid', schema: 'compact-slices/v1', manifest: raw as unknown as CompactPlanManifest };
}
