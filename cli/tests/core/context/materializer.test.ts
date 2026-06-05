// cli/tests/core/context/materializer.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { materialize, globalContextPath } from '../../../src/core/context/materializer';
import { sha256 } from '../../../src/core/context/provider';
import { AwmContext } from '../../../src/core/context/types';

function ctxOf(markdown: string): AwmContext {
    return { markdown, sourceVersion: '1.0.0', contentHash: sha256(markdown) };
}

describe('globalContextPath', () => {
    it('points under AWM_HOME/context', () => {
        expect(globalContextPath()).toContain(path.join('context', 'awm-context.md'));
    });
});

describe('materialize', () => {
    it('writes the content and returns a ref with the matching hash', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mat-'));
        const abs = path.join(dir, 'awm-context.md');
        const ctx = ctxOf('CONTENT-A');
        const ref = materialize(ctx, abs, 'global');
        expect(ref).toEqual({ absPath: abs, scope: 'global', contentHash: ctx.contentHash });
        expect(fs.readFileSync(abs, 'utf-8')).toBe('CONTENT-A');
    });

    it('is a no-op when the on-disk hash already matches (mtime unchanged)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mat-'));
        const abs = path.join(dir, 'awm-context.md');
        const ctx = ctxOf('CONTENT-A');
        materialize(ctx, abs, 'global');
        const mtime1 = fs.statSync(abs).mtimeMs;
        materialize(ctx, abs, 'global'); // same content
        expect(fs.statSync(abs).mtimeMs).toBe(mtime1);
    });

    it('rewrites when the content changed', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mat-'));
        const abs = path.join(dir, 'awm-context.md');
        materialize(ctxOf('CONTENT-A'), abs, 'global');
        const ref = materialize(ctxOf('CONTENT-B'), abs, 'global');
        expect(fs.readFileSync(abs, 'utf-8')).toBe('CONTENT-B');
        expect(ref.contentHash).toBe(sha256('CONTENT-B'));
    });
});
