import fs from 'fs';
import path from 'path';
import { isValidRecordFileName, loadFrontmatter, splitRecord } from './parse';
import { BODY_HEADINGS, MAX_DIAGNOSTICS, MAX_RECORD_BYTES, PENDING_MARKER, RECORD_SCHEMA, type ChangeRecord, type Diagnostic } from './types';

const TOP_KEYS = ['schema', 'id', 'title', 'summary_short', 'type', 'scope', 'semver', 'breaking', 'modules', 'links', 'verification', 'manual_validation', 'risks', 'rollback', 'provenance'];
const REQUIRED_KEYS = TOP_KEYS.filter((k) => k !== 'links' && k !== 'provenance');
const SENSOR_STATUS = ['pass', 'fail', 'inconclusive', 'skipped'];
const OVERALL = ['pass', 'fail', 'skipped', 'not_certified'];
const SEMVER = ['major', 'minor', 'patch', 'none'];
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

// ---- Text safety (R1.4): the one place that defines which characters are unsafe in record text. ----
// Control characters are C0 (includes \t \n \r), DEL and C1 (includes U+0085). U+2028/U+2029 are line breaks but not controls.
const CONTROL_CLASS = '\\u0000-\\u001f\\u007f-\\u009f';
const SINGLE_LINE_UNSAFE = new RegExp(`[${CONTROL_CLASS}\\u2028\\u2029]`);
const SINGLE_LINE_UNSAFE_ALL = new RegExp(SINGLE_LINE_UNSAFE.source, 'g');
const MULTILINE_UNSAFE = new RegExp(`[${CONTROL_CLASS}]`);

/** A string with no line break and no control character. */
export const isSingleLine = (text: unknown): text is string => typeof text === 'string' && !SINGLE_LINE_UNSAFE.test(text);
/** A string whose only control characters are `\n` and `\t`. */
export const isSafeMultiline = (text: unknown): text is string => typeof text === 'string' && !MULTILINE_UNSAFE.test(text.replace(/[\n\t]/g, ''));

const unicodeEscape = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const MAX_ECHO_CODE_POINTS = 80;
const MAX_ECHO_ESCAPED = 240;
const MAX_MESSAGE = 300;

/** Attacker-controlled text made safe to embed in a diagnostic: bounded, JSON-escaped, never containing a raw line break or control. */
function esc(text: string): string {
    const points = [...text];
    const clipped = points.length > MAX_ECHO_CODE_POINTS ? `${points.slice(0, MAX_ECHO_CODE_POINTS).join('')}…` : text;
    let escaped = JSON.stringify(clipped).slice(1, -1).replace(SINGLE_LINE_UNSAFE_ALL, unicodeEscape);
    if (escaped.length > MAX_ECHO_ESCAPED) escaped = `${sliceNoSplit(escaped, MAX_ECHO_ESCAPED)}…`;
    return escaped;
}

const cleanText = (text: string): string => text.replace(SINGLE_LINE_UNSAFE_ALL, unicodeEscape);

/** Cuts at `maxUnits` UTF-16 units, dropping a trailing high surrogate so a pair is never split. The only cut of untrusted text by unit count. */
function sliceNoSplit(text: string, maxUnits: number): string {
    if (text.length <= maxUnits) return text;
    const last = text.charCodeAt(maxUnits - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? maxUnits - 1 : maxUnits);
}

/** Clips to MAX_MESSAGE UTF-16 units including the ellipsis. */
function clipMessage(message: string): string {
    return message.length <= MAX_MESSAGE ? message : `${sliceNoSplit(message, MAX_MESSAGE - 1)}…`;
}

/** Last line of defense for R1.8: single-line message/field, bounded length, at most MAX_DIAGNOSTICS entries. */
function finalize(list: Diagnostic[]): Diagnostic[] {
    const clean = list.map((d): Diagnostic => {
        const message = cleanText(d.message);
        const base: Diagnostic = { code: d.code, message: clipMessage(message) };
        return d.field === undefined ? base : { ...base, field: cleanText(d.field) };
    });
    if (clean.length <= MAX_DIAGNOSTICS) return clean;
    const kept = clean.slice(0, MAX_DIAGNOSTICS - 1);
    return [...kept, { code: 'diagnostics-truncated', message: `${clean.length - kept.length} more diagnostics omitted` }];
}

// ---- Value predicates ----
const isSensorName = (k: string): boolean => k.length > 0 && [...k].length <= 128 && isSingleLine(k);
const isCanonicalIso = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

function isSafeRelative(p: string): boolean {
    if (!isSingleLine(p) || p.length === 0 || path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
    return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function isModulePath(m: unknown): boolean {
    return typeof m === 'string' && m === m.trim() && (m === '.' || isSafeRelative(m));
}

const URL_WHITESPACE = /\s/;
function isHttpsIssueUrl(v: unknown): boolean {
    if (!isSingleLine(v) || URL_WHITESPACE.test(v) || !/^https:\/\/[^/?#\\@]/.test(v)) return false;
    try {
        const u = new URL(v);
        return u.protocol === 'https:' && u.hostname.length > 0;
    } catch { return false; }
}

function isRegularFileInside(root: string, rel: string): boolean {
    const abs = path.join(root, rel);
    try {
        if (!fs.lstatSync(abs).isFile()) return false;
        const relToRoot = path.relative(fs.realpathSync(root), fs.realpathSync(abs));
        return relToRoot !== '' && relToRoot !== '..' && !relToRoot.startsWith('..' + path.sep) && !path.isAbsolute(relToRoot);
    } catch { return false; }
}

function containsPendingString(value: unknown): boolean {
    if (typeof value === 'string') return value.includes(PENDING_MARKER);
    if (Array.isArray(value)) return value.some(containsPendingString);
    if (isObj(value)) return Object.entries(value).some(([k, val]) => k.includes(PENDING_MARKER) || containsPendingString(val));
    return false;
}

// ---- Diagnostic helpers ----
function unknownKeys(obj: Obj, allowed: string[], prefix: string, out: Diagnostic[]): void {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) {
            const field = prefix + esc(key);
            out.push({ code: 'unknown-field', field, message: `unknown field "${field}"` });
        }
    }
}

function bad(out: Diagnostic[], field: string, message: string): void {
    out.push({ code: 'field-invalid', field, message });
}

// ---- Body ----
function checkBody(body: string, out: Diagnostic[]): void {
    const lines = body.split('\n');
    const headingIdx = lines.map((l, i) => (l.startsWith('## ') ? i : -1)).filter((i) => i >= 0);
    let cursor = -1;
    for (const heading of BODY_HEADINGS) {
        const at = headingIdx.find((i) => i > cursor && lines[i].trimEnd() === heading);
        if (at === undefined) { out.push({ code: 'body-section-missing', message: `missing or out-of-order section "${heading}"` }); return; }
        const next = headingIdx.find((i) => i > at) ?? lines.length;
        if (lines.slice(at + 1, next).join('\n').trim().length === 0) {
            out.push({ code: 'body-section-missing', message: `section "${heading}" is empty` });
            return;
        }
        cursor = at;
    }
}

// ---- Frontmatter sections ----
function checkIdentity(fm: Obj, fileName: string, out: Diagnostic[]): void {
    if (fm.schema !== RECORD_SCHEMA) bad(out, 'schema', `schema must be ${RECORD_SCHEMA}`);
    if (fm.id !== fileName.replace(/\.md$/, '')) bad(out, 'id', 'id must equal the file name without .md');
    if (!nonEmpty(fm.title) || !isSingleLine(fm.title) || [...fm.title].length > 120) bad(out, 'title', 'title must be 1-120 characters on one line');
    if (!nonEmpty(fm.summary_short) || !isSingleLine(fm.summary_short) || [...fm.summary_short].length > 280) bad(out, 'summary_short', 'summary_short must be 1-280 characters on one line');
    if (typeof fm.type !== 'string' || !/^[a-z]+$/.test(fm.type)) bad(out, 'type', 'type must be a lowercase conventional-commit type');
    if (!(fm.scope === null || (nonEmpty(fm.scope) && isSingleLine(fm.scope)))) bad(out, 'scope', 'scope must be a single-line string or null');
    if (!SEMVER.includes(fm.semver as string)) bad(out, 'semver', `semver must be one of ${SEMVER.join('|')}`);
    if (typeof fm.breaking !== 'boolean') bad(out, 'breaking', 'breaking must be a boolean');
}

function checkModules(fm: Obj, out: Diagnostic[]): void {
    const mods = fm.modules;
    if (!Array.isArray(mods) || !mods.every(isModulePath) || JSON.stringify([...new Set(mods as string[])].sort()) !== JSON.stringify(mods)) {
        bad(out, 'modules', 'modules must be a sorted, unique array of repo-relative directories');
    }
}

function checkLinks(fm: Obj, root: string | undefined, out: Diagnostic[]): void {
    if (fm.links === undefined) return;
    if (!isObj(fm.links)) { bad(out, 'links', 'links must be a mapping'); return; }
    unknownKeys(fm.links, ['plan', 'issue'], 'links.', out);
    const { plan, issue } = fm.links;
    if (plan !== undefined) {
        if (typeof plan !== 'string' || !isSafeRelative(plan)) bad(out, 'links.plan', 'links.plan must be a safe single-line repo-relative path');
        else if (root !== undefined && !isRegularFileInside(root, plan)) bad(out, 'links.plan', `links.plan "${esc(plan)}" does not exist as a regular file`);
    }
    if (issue !== undefined && !isHttpsIssueUrl(issue)) bad(out, 'links.issue', 'links.issue must be an https URL');
}

function checkVerification(fm: Obj, out: Diagnostic[]): void {
    const v = fm.verification;
    if (!isObj(v)) { bad(out, 'verification', 'verification must be a mapping'); return; }
    unknownKeys(v, ['commit', 'overall', 'sensors', 'receipt_digest'], 'verification.', out);
    if (typeof v.commit !== 'string' || !SHA_RE.test(v.commit)) bad(out, 'verification.commit', 'verification.commit must be 40 lowercase hex characters');
    if (!OVERALL.includes(v.overall as string)) bad(out, 'verification.overall', `overall must be one of ${OVERALL.join('|')}`);
    if (!isObj(v.sensors) || !Object.entries(v.sensors).every(([k, s]) => isSensorName(k) && SENSOR_STATUS.includes(s as string))) {
        bad(out, 'verification.sensors', 'sensors must map sensor names to pass|fail|inconclusive|skipped');
    }
    if (typeof v.receipt_digest !== 'string' || !DIGEST_RE.test(v.receipt_digest)) bad(out, 'verification.receipt_digest', 'receipt_digest must be sha256:<64 hex>');
}

const isNarrative = (v: unknown): v is string => nonEmpty(v) && isSafeMultiline(v);

function checkNarrative(fm: Obj, out: Diagnostic[]): void {
    const mv = fm.manual_validation;
    if (Array.isArray(mv)) {
        if (mv.length === 0) bad(out, 'manual_validation', 'manual_validation must not be empty; use {none: <reason>}');
        mv.forEach((item, i) => {
            if (!isObj(item)) { bad(out, `manual_validation.${i}`, 'item must be a mapping'); return; }
            unknownKeys(item, ['step', 'expected'], `manual_validation.${i}.`, out);
            if (!isNarrative(item.step) || !isNarrative(item.expected)) bad(out, `manual_validation.${i}`, 'step and expected must be non-empty strings without control characters');
        });
    } else if (isObj(mv)) {
        unknownKeys(mv, ['none'], 'manual_validation.', out);
        if (!isNarrative(mv.none)) bad(out, 'manual_validation.none', 'none must state a non-empty reason without control characters');
    } else bad(out, 'manual_validation', 'manual_validation must be a list or {none: <reason>}');

    if (!Array.isArray(fm.risks) || !fm.risks.every(isNarrative)) bad(out, 'risks', 'risks must be an array of non-empty strings without control characters');
    if (!isNarrative(fm.rollback)) bad(out, 'rollback', 'rollback must be a non-empty string without control characters');
}

function checkProvenance(fm: Obj, out: Diagnostic[]): void {
    if (fm.provenance === undefined) return;
    if (!isObj(fm.provenance)) { bad(out, 'provenance', 'provenance must be a mapping'); return; }
    unknownKeys(fm.provenance, ['agent', 'model', 'session', 'started_at', 'finished_at'], 'provenance.', out);
    for (const [k, val] of Object.entries(fm.provenance)) {
        const field = `provenance.${esc(k)}`;
        if (!nonEmpty(val) || !isSingleLine(val)) bad(out, field, `${field} must be a non-empty single-line string`);
        else if ((k === 'started_at' || k === 'finished_at') && !isCanonicalIso(val)) bad(out, field, `${field} must be canonical ISO-8601`);
    }
}

export interface ShapeOptions { root?: string }

export function validateRecordShape(fileName: string, raw: string, opts: ShapeOptions = {}): { record?: ChangeRecord; diagnostics: Diagnostic[] } {
    if (typeof fileName !== 'string' || typeof raw !== 'string') {
        return { diagnostics: [{ code: 'input-invalid', message: 'fileName and raw must both be strings' }] };
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) {
        return { diagnostics: [{ code: 'record-too-large', message: `record exceeds ${MAX_RECORD_BYTES} bytes` }] };
    }
    const root = typeof opts?.root === 'string' ? opts.root : undefined;
    const out: Diagnostic[] = [];
    if (!isValidRecordFileName(fileName)) out.push({ code: 'name-invalid', message: `file name "${esc(fileName)}" must be YYYY-MM-DD-<slug>.md with a valid date and slug of at most 64 chars` });
    const stop = (...more: Diagnostic[]) => ({ diagnostics: finalize([...out, ...more]) });

    const split = splitRecord(raw);
    if (!split.ok) return stop(split.diagnostic);
    if (split.frontmatterText.includes(PENDING_MARKER) || split.body.includes(PENDING_MARKER)) {
        out.push({ code: 'pending-content', message: 'record still contains <!-- awm:pending --> placeholders' });
    }
    checkBody(split.body, out);
    const loaded = loadFrontmatter(split.frontmatterText);
    if (!loaded.ok) return stop(loaded.diagnostic);
    const fm = loaded.value;
    if (!isObj(fm)) return stop({ code: 'not-an-object', message: 'frontmatter must be a mapping' });

    if (!out.some((d) => d.code === 'pending-content') && containsPendingString(fm)) {
        out.push({ code: 'pending-content', message: 'record still contains <!-- awm:pending --> placeholders' });
    }
    unknownKeys(fm, TOP_KEYS, '', out);
    for (const key of REQUIRED_KEYS) if (!(key in fm)) bad(out, key, `missing required field "${key}"`);
    checkIdentity(fm, fileName, out);
    checkModules(fm, out);
    checkLinks(fm, root, out);
    checkVerification(fm, out);
    checkNarrative(fm, out);
    checkProvenance(fm, out);

    if (out.length === 0) return { record: fm as unknown as ChangeRecord, diagnostics: [] };
    return { diagnostics: finalize(out) };
}
