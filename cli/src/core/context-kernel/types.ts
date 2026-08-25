export type ContextTier = 'kernel' | 'selective';

export type ContextEntryV1 = {
    id: string;
    tier: ContextTier;
    path: string;
    anchor: string;
    when: string;
};

export type ContextIndexV1 = {
    schema: 1;
    kernelFiles: string[];
    maxFixedBytes: number;
    entries: ContextEntryV1[];
};

export type ContextKernelInspection =
    | { state: 'legacy' }
    | { state: 'valid'; schema: 1; index: ContextIndexV1; fixedBytes: number }
    | { state: 'invalid'; detail: string; remedy: string };
