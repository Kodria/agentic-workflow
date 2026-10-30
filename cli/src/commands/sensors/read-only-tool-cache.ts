/**
 * Admission readOnly spawn filter (issue #240 / DD-8). For executable === 'eslint'
 * only, removes ESLint tool-cache argv so sensors do not create ./.eslintcache.
 * Operator runs keep --cache; non-eslint tools keep their argv (e.g. rubocop --cache false).
 */
export function stripReadOnlyToolCacheArgs(executable: string, args: readonly string[]): string[] {
    if (typeof executable !== 'string' || executable.trim() === '') {
        throw new Error('stripReadOnlyToolCacheArgs executable must be a nonempty string');
    }
    if (!Array.isArray(args)) throw new Error('stripReadOnlyToolCacheArgs args must be an array');
    for (const [index, arg] of args.entries()) {
        if (typeof arg !== 'string' || arg === '') {
            throw new Error(`stripReadOnlyToolCacheArgs args[${index}] must be a nonempty string`);
        }
    }
    if (executable !== 'eslint') return [...args];
    const hasCache = args.includes('--cache');
    if (!hasCache) return [...args];
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--cache') continue;
        if (arg === '--cache-location') {
            if (i + 1 < args.length) i += 1;
            continue;
        }
        out.push(arg);
    }
    return out;
}
