import yaml from 'js-yaml';
import { clipMessage, escapeText } from './text-safety';
import type { Diagnostic } from './types';

export const RECORD_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: unknown): slug is string {
    return typeof slug === 'string' && slug.length > 0 && slug.length <= 64 && SLUG_RE.test(slug);
}

export function isValidRecordFileName(name: unknown): boolean {
    if (typeof name !== 'string') return false;
    const m = RECORD_FILE_RE.exec(name);
    if (!m || !isValidSlug(m[4])) return false;
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const INPUT_INVALID: Diagnostic = { code: 'input-invalid', message: 'input must be a string' };

export type Split = { ok: true; frontmatterText: string; body: string } | { ok: false; diagnostic: Diagnostic };

/** Normalizes CRLF and splits a leading `---` frontmatter block from the body. */
export function splitRecord(raw: string): Split {
    if (typeof raw !== 'string') return { ok: false, diagnostic: INPUT_INVALID };
    const text = raw.replace(/\r\n/g, '\n');
    if (!text.startsWith('---\n')) return { ok: false, diagnostic: { code: 'frontmatter-missing', message: 'record must start with a --- frontmatter block' } };
    const end = text.indexOf('\n---\n', 3);
    if (end < 0) return { ok: false, diagnostic: { code: 'frontmatter-missing', message: 'frontmatter block is not closed with ---' } };
    return { ok: true, frontmatterText: text.slice(4, end), body: text.slice(end + 5) };
}

export type Loaded = { ok: true; value: unknown } | { ok: false; diagnostic: Diagnostic };

/**
 * CORE_SCHEMA: no custom tags, no implicit timestamps (dates stay strings).
 * Every anchor is rejected (scalar, collection, used or unused); an alias cannot exist without one.
 * The parse listener sees the anchor of each node on `close`, so quoted `&a` / `*a` text is unaffected.
 */
export function loadFrontmatter(text: string): Loaded {
    if (typeof text !== 'string') return { ok: false, diagnostic: INPUT_INVALID };
    let value: unknown;
    let anchored = false;
    try {
        value = yaml.load(text, {
            schema: yaml.CORE_SCHEMA,
            json: false,
            listener: (event, state) => {
                if (event === 'close' && (state as unknown as { anchor: string | null }).anchor !== null) anchored = true;
            },
        });
    } catch (error) {
        return { ok: false, diagnostic: { code: 'yaml-invalid', message: clipMessage(`frontmatter is not valid YAML: ${escapeText((error as Error).message.split('\n')[0])}`) } };
    }
    if (anchored) return { ok: false, diagnostic: { code: 'yaml-alias', message: 'YAML anchors/aliases are not allowed' } };
    return { ok: true, value };
}
