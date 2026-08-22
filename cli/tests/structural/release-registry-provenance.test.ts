import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_WORKFLOW = path.join(CLI_ROOT, '..', '.github', 'workflows', 'release.yml');

describe('release registry provenance', () => {
    const workflow = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');

    it('resolves the immutable registry tag before publishing the CLI', () => {
        expect(workflow).toContain('Resolve immutable Task 7 registry commit');
        expect(workflow).toContain('refs/tags/${REGISTRY_TAG}^{}');
        expect(workflow).toContain('AWM_PUBLISHED_REGISTRY_TAG: v3.4.0');
        expect(workflow).not.toContain('AWM_REGISTRY_V3_4_0_COMMIT');
        expect(workflow.indexOf('Resolve immutable Task 7 registry commit'))
            .toBeLessThan(workflow.indexOf('- name: Release'));
        expect(workflow).toMatch(/REGISTRY_TAG: v3\.4\.0[\s\S]*AWM_PUBLISHED_REGISTRY_TAG: v3\.4\.0/);
    });
});
