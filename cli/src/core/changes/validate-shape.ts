import fs from 'fs';
import path from 'path';
import { isValidRecordFileName, loadFrontmatter, splitRecord } from './parse';
import { BODY_HEADINGS, MAX_RECORD_BYTES, PENDING_MARKER, RECORD_SCHEMA, type ChangeRecord, type Diagnostic } from './types';

const TOP_KEYS = ['schema', 'id', 'title', 'summary_short', 'type', 'scope', 'semver', 'breaking', 'modules', 'links', 'verification', 'manual_validation', 'risks', 'rollback', 'provenance'];
const REQUIRED_KEYS = TOP_KEYS.filter((k) => k !== 'links' && k !== 'provenance');
const SENSOR_STATUS = ['pass', 'fail', 'inconclusive', 'skipped'];
const OVERALL = ['pass', 'fail', 'skipped', 'not_certified'];
const SEMVER = ['major', 'minor', 'patch', 'none'];
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MODULE_RE = /^(?:\.|[^/\\\0]+(?:\/[^/\\\0]+)*)$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const isSensorName = (k: string): boolean => k.length > 0 && k.length <= 128 && !CONTROL_RE.test(k);
function containsPendingString(value: unknown): boolean {
    if (typeof value === 'string') return value.includes(PENDING_MARKER);
    if (Array.isArray(value)) return value.some(containsPendingString);
    if (isObj(value)) return Object.entries(value).some(([k, val]) => k.includes(PENDING_MARKER) || containsPendingString(val));
    return false;
}
const isCanonicalIso = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

function unknownKeys(obj: Obj, allowed: string[], prefix: string, out: Diagnostic[]): void {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) out.push({ code: 'unknown-field', field: prefix + key, message: `unknown field "${prefix + key}"` });
    }
}

function bad(out: Diagnostic[], field: string, message: string): void {
    out.push({ code: 'field-invalid', field, message });
}

function isSafeRelative(p: string): boolean {
    if (p.length === 0 || path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\\') || p.includes('\0')) return false;
    return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

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

export interface ShapeOptions { root?: string }

export function validateRecordShape(fileName: string, raw: string, opts: ShapeOptions = {}): { record?: ChangeRecord; diagnostics: Diagnostic[] } {
    if (Buffer.byteLength(raw, 'utf8') > MAX_RECORD_BYTES) {
        return { diagnostics: [{ code: 'record-too-large', message: `record exceeds ${MAX_RECORD_BYTES} bytes` }] };
    }
    const out: Diagnostic[] = [];
    if (!isValidRecordFileName(fileName)) out.push({ code: 'name-invalid', message: `file name "${fileName}" must be YYYY-MM-DD-<slug>.md with a valid date and slug of at most 64 chars` });
    const split = splitRecord(raw);
    if (!split.ok) return { diagnostics: [...out, split.diagnostic] };
    if (split.frontmatterText.includes(PENDING_MARKER) || split.body.includes(PENDING_MARKER)) {
        out.push({ code: 'pending-content', message: 'record still contains <!-- awm:pending --> placeholders' });
    }
    checkBody(split.body, out);
    const loaded = loadFrontmatter(split.frontmatterText);
    if (!loaded.ok) return { diagnostics: [...out, loaded.diagnostic] };
    const fm = loaded.value;
    if (!isObj(fm)) return { diagnostics: [...out, { code: 'not-an-object', message: 'frontmatter must be a mapping' }] };

    if (!out.some((d) => d.code === 'pending-content') && containsPendingString(fm)) {
        out.push({ code: 'pending-content', message: 'record still contains <!-- awm:pending --> placeholders' });
    }
    unknownKeys(fm, TOP_KEYS, '', out);
    for (const key of REQUIRED_KEYS) if (!(key in fm)) bad(out, key, `missing required field "${key}"`);

    if (fm.schema !== RECORD_SCHEMA) bad(out, 'schema', `schema must be ${RECORD_SCHEMA}`);
    if (fm.id !== fileName.replace(/\.md$/, '')) bad(out, 'id', 'id must equal the file name without .md');
    if (!nonEmpty(fm.title) || [...fm.title].length > 120) bad(out, 'title', 'title must be 1-120 characters');
    if (!nonEmpty(fm.summary_short) || [...fm.summary_short].length > 280 || /[\r\n\u0085\u2028\u2029]/.test(fm.summary_short)) bad(out, 'summary_short', 'summary_short must be 1-280 characters on one line');
    if (typeof fm.type !== 'string' || !/^[a-z]+$/.test(fm.type)) bad(out, 'type', 'type must be a lowercase conventional-commit type');
    if (!(fm.scope === null || nonEmpty(fm.scope))) bad(out, 'scope', 'scope must be a string or null');
    if (!SEMVER.includes(fm.semver as string)) bad(out, 'semver', `semver must be one of ${SEMVER.join('|')}`);
    if (typeof fm.breaking !== 'boolean') bad(out, 'breaking', 'breaking must be a boolean');
    const mods = fm.modules;
    if (!Array.isArray(mods) || !mods.every((m) => typeof m === 'string' && MODULE_RE.test(m) && (m === '.' || isSafeRelative(m)))
        || JSON.stringify([...new Set(mods as string[])].sort()) !== JSON.stringify(mods)) {
        bad(out, 'modules', 'modules must be a sorted, unique array of repo-relative directories');
    }

    if (fm.links !== undefined) {
        if (!isObj(fm.links)) bad(out, 'links', 'links must be a mapping');
        else {
            unknownKeys(fm.links, ['plan', 'issue'], 'links.', out);
            const { plan, issue } = fm.links;
            if (plan !== undefined) {
                if (typeof plan !== 'string' || !isSafeRelative(plan)) bad(out, 'links.plan', 'links.plan must be a safe repo-relative path');
                else if (opts.root !== undefined) {
                    const abs = path.join(opts.root, plan);
                    let ok = false;
                    try { ok = fs.lstatSync(abs).isFile(); } catch { ok = false; }
                    if (!ok) bad(out, 'links.plan', `links.plan "${plan}" does not exist as a regular file`);
                }
            }
            if (issue !== undefined) {
                let ok = false;
                try { ok = typeof issue === 'string' && new URL(issue).protocol === 'https:'; } catch { ok = false; }
                if (!ok) bad(out, 'links.issue', 'links.issue must be an https URL');
            }
        }
    }

    const v = fm.verification;
    if (!isObj(v)) bad(out, 'verification', 'verification must be a mapping');
    else {
        unknownKeys(v, ['commit', 'overall', 'sensors', 'receipt_digest'], 'verification.', out);
        if (typeof v.commit !== 'string' || !SHA_RE.test(v.commit)) bad(out, 'verification.commit', 'verification.commit must be 40 lowercase hex characters');
        if (!OVERALL.includes(v.overall as string)) bad(out, 'verification.overall', `overall must be one of ${OVERALL.join('|')}`);
        if (!isObj(v.sensors) || !Object.entries(v.sensors).every(([k, s]) => isSensorName(k) && SENSOR_STATUS.includes(s as string))) {
            bad(out, 'verification.sensors', 'sensors must map sensor names to pass|fail|inconclusive|skipped');
        }
        if (typeof v.receipt_digest !== 'string' || !DIGEST_RE.test(v.receipt_digest)) bad(out, 'verification.receipt_digest', 'receipt_digest must be sha256:<64 hex>');
    }

    const mv = fm.manual_validation;
    if (Array.isArray(mv)) {
        if (mv.length === 0) bad(out, 'manual_validation', 'manual_validation must not be empty; use {none: <reason>}');
        mv.forEach((item, i) => {
            if (!isObj(item)) { bad(out, `manual_validation.${i}`, 'item must be a mapping'); return; }
            unknownKeys(item, ['step', 'expected'], `manual_validation.${i}.`, out);
            if (!nonEmpty(item.step) || !nonEmpty(item.expected)) bad(out, `manual_validation.${i}`, 'step and expected must be non-empty strings');
        });
    } else if (isObj(mv)) {
        unknownKeys(mv, ['none'], 'manual_validation.', out);
        if (!nonEmpty(mv.none)) bad(out, 'manual_validation.none', 'none must state a non-empty reason');
    } else bad(out, 'manual_validation', 'manual_validation must be a list or {none: <reason>}');

    if (!Array.isArray(fm.risks) || !fm.risks.every(nonEmpty)) bad(out, 'risks', 'risks must be an array of non-empty strings');
    if (!nonEmpty(fm.rollback)) bad(out, 'rollback', 'rollback must be a non-empty string');

    if (fm.provenance !== undefined) {
        if (!isObj(fm.provenance)) bad(out, 'provenance', 'provenance must be a mapping');
        else {
            unknownKeys(fm.provenance, ['agent', 'model', 'session', 'started_at', 'finished_at'], 'provenance.', out);
            for (const [k, val] of Object.entries(fm.provenance)) {
                if (!nonEmpty(val)) bad(out, `provenance.${k}`, `provenance.${k} must be a non-empty string`);
                else if ((k === 'started_at' || k === 'finished_at') && !isCanonicalIso(val)) bad(out, `provenance.${k}`, `provenance.${k} must be canonical ISO-8601`);
            }
        }
    }

    return out.length === 0 ? { record: fm as unknown as ChangeRecord, diagnostics: [] } : { diagnostics: out };
}
