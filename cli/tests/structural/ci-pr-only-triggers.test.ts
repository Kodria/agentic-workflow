import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');

function loadWorkflow(file: string): { raw: string; doc: Record<string, unknown> } {
    const raw = fs.readFileSync(file, 'utf8');
    const doc = yaml.load(raw) as Record<string, unknown>;
    if (!doc || typeof doc !== 'object') throw new Error(`${file}: failed to parse YAML`);
    return { raw, doc };
}

describe('ci.yml is PR-only; release.yml remains the main push gate (#244)', () => {
    const ci = loadWorkflow(CI_WORKFLOW);
    const release = loadWorkflow(RELEASE_WORKFLOW);

    it('RF-1.1: ci on: has pull_request and no push', () => {
        const on = ci.doc.on as Record<string, unknown>;
        expect(on).toBeTruthy();
        expect(Object.prototype.hasOwnProperty.call(on, 'pull_request')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(on, 'push')).toBe(false);
        expect(ci.raw).not.toMatch(/^\s*push:\s*$/m);
        expect(ci.raw).not.toMatch(/branches:\s*\[\s*main\s*\]/);
    });

    it('RF-1.2: ci concurrency cancels in-progress runs for the same ref', () => {
        const concurrency = ci.doc.concurrency as { group?: string; 'cancel-in-progress'?: boolean };
        expect(concurrency).toEqual({
            group: 'ci-${{ github.ref }}',
            'cancel-in-progress': true,
        });
    });

    it('RF-1.3: release still pushes on main and never cancels in-flight releases', () => {
        const on = release.doc.on as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(on, 'push')).toBe(true);
        const push = on.push as { branches?: string[] };
        expect(push.branches).toEqual(['main']);
        const concurrency = release.doc.concurrency as { group?: string; 'cancel-in-progress'?: boolean };
        expect(concurrency.group).toBe('release-${{ github.ref }}');
        expect(concurrency['cancel-in-progress']).toBe(false);
    });
});
