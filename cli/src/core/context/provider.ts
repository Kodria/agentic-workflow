// cli/src/core/context/provider.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AwmContext } from './types';

export function sha256(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

export type ContextInput = {
    registryRoot: string;
    profileExtensions: string[];
};

function parseVersion(skill: string): string {
    const m = skill.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
    return m ? m[1].trim() : '0.0.0';
}

export function buildContext(input: ContextInput): AwmContext {
    const skillPath = path.join(input.registryRoot, 'skills/using-awm/SKILL.md');
    if (!fs.existsSync(skillPath)) {
        throw new Error(`using-awm skill not found at ${skillPath}. Run 'awm update' first.`);
    }
    const skill = fs.readFileSync(skillPath, 'utf-8');
    const exts = input.profileExtensions.length ? input.profileExtensions.join(', ') : 'none';
    const header = `<!-- AWM context (generated) -->\n# AWM\n\nActive extensions: ${exts}\n\n`;
    const markdown = header + skill;
    return { markdown, sourceVersion: parseVersion(skill), contentHash: sha256(markdown) };
}
