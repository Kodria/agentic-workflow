import path from 'path';
import { SensorError } from '../types';

export const SUITE_FAILED_RULE = '<suite-failed>';

export type TestParseResult = {
    findings: SensorError[];
    explainsNonZeroExit: boolean;
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI, trim, collapse internal whitespace to a single space (RF-2.4). */
export function normalizeRule(raw: string): string {
    return raw.replace(ANSI_RE, '').trim().replace(/\s+/g, ' ');
}

/**
 * Execution-cwd-relative path with `/` separators. Paths outside root stay as returned (RF-2.2).
 */
export function relativizeTestFile(root: string, runnerPath: string): string {
    if (!runnerPath) return '';
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedPath = runnerPath.replace(/\\/g, '/');
    if (path.isAbsolute(runnerPath) || /^[A-Za-z]:\//.test(normalizedPath)) {
        const absRoot = path.resolve(root);
        const absPath = path.resolve(runnerPath);
        const rel = path.relative(absRoot, absPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return normalizedPath;
        }
        return rel.split(path.sep).join('/');
    }
    // Already relative — normalize separators only.
    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')) {
        return normalizedPath.slice(normalizedRoot.length).replace(/^\//, '') || normalizedPath;
    }
    return normalizedPath;
}

export function emptyParseResult(): TestParseResult {
    return { findings: [], explainsNonZeroExit: false };
}

export function finding(file: string, rule: string): SensorError {
    const normalized = normalizeRule(rule);
    return {
        file,
        rule: normalized,
        // RF-2.* leaves message unspecified; fingerprint uses file|rule when rule is set.
        message: normalized,
    };
}
