import path from 'path';
import { awmHome } from '../paths';

export function userPolicyPath(): string { return path.join(awmHome(), 'model-policy.json'); }
export function projectPolicyPath(cwd: string): string { if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cwd must be a non-empty path'); return path.join(path.resolve(cwd), '.awm', 'model-policy.json'); }
