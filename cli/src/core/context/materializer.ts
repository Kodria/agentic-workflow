// cli/src/core/context/materializer.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AwmContext, MaterializedRef } from './types';
import { sha256 } from './provider';
import { Scope } from '../../providers';

function awmHome(): string {
    return process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');
}

export function globalContextPath(): string {
    return path.join(awmHome(), 'context', 'awm-context.md');
}

export function materialize(ctx: AwmContext, absPath: string, scope: Scope): MaterializedRef {
    let onDisk: string | null = null;
    try { onDisk = sha256(fs.readFileSync(absPath, 'utf-8')); } catch { /* file absent or removed */ }
    if (onDisk !== ctx.contentHash) {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, ctx.markdown, 'utf-8');
    }
    return { absPath, scope, contentHash: ctx.contentHash };
}
