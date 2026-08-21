export function positiveTimeout(value: unknown, location: string): number {
    if (typeof location !== 'string' || location.trim() === '') throw new Error('timeout location must be a nonempty string');
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${location} must be a positive safe integer`);
    }
    return value;
}

export function resolveTimeout(input: {
    project?: number;
    pack?: number;
    fast: boolean;
}): { timeoutMs: number; source: 'project' | 'pack' | 'fallback' } {
    if (!input || typeof input !== 'object' || typeof input.fast !== 'boolean') throw new Error('timeout resolution input is invalid');
    if (input.project !== undefined) return { timeoutMs: positiveTimeout(input.project, 'project timeout'), source: 'project' };
    if (input.pack !== undefined) return { timeoutMs: positiveTimeout(input.pack, 'pack timeout'), source: 'pack' };
    return { timeoutMs: input.fast ? 10_000 : 120_000, source: 'fallback' };
}
