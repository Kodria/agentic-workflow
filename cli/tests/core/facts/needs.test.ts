import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseFactsCatalog } from '../../../src/core/facts/catalog';
import { findOrphanNeeds, readSkillNeeds } from '../../../src/core/facts/needs';
import { SkillNeedsError } from '../../../src/core/facts/types';

describe('readSkillNeeds / findOrphanNeeds (RF-1.2, RF-1.3, RF-1.4)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-needs-'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function writeSkill(body: string): string {
        const dir = path.join(tmp, 'skills', 'demo');
        fs.mkdirSync(dir, { recursive: true });
        const skillPath = path.join(dir, 'SKILL.md');
        fs.writeFileSync(skillPath, body);
        return skillPath;
    }

    it('resolves needs: [repos.root] from frontmatter (RF-1.2)', () => {
        const skillPath = writeSkill(`---
name: demo
description: d
needs:
  - repos.root
---
# Demo
`);
        expect(readSkillNeeds(skillPath)).toEqual(['repos.root']);
    });

    it('accepts flow-style needs list', () => {
        const skillPath = writeSkill(`---
name: demo
description: d
needs: [repos.root, aws.profile.dev]
---
# Demo
`);
        expect(readSkillNeeds(skillPath)).toEqual(['repos.root', 'aws.profile.dev']);
    });

    it('returns empty when needs omitted (RF-1.4)', () => {
        const skillPath = writeSkill(`---
name: demo
description: d
---
# Demo
`);
        expect(readSkillNeeds(skillPath)).toEqual([]);
    });

    it('throws SkillNeedsError for invalid needs shape', () => {
        const skillPath = writeSkill(`---
name: demo
description: d
needs: repos.root
---
# Demo
`);
        expect(() => readSkillNeeds(skillPath)).toThrow(SkillNeedsError);
    });

    it('lists unknown ids as orphans without inventing facts (RF-1.3)', () => {
        const catalog = parseFactsCatalog({
            schemaVersion: 1,
            facts: { 'repos.root': { valueType: 'path' } },
        });
        expect(findOrphanNeeds(['repos.root', 'ghost.fact'], catalog)).toEqual(['ghost.fact']);
        expect(findOrphanNeeds(['repos.root'], catalog)).toEqual([]);
        expect(findOrphanNeeds([], catalog)).toEqual([]);
    });

    it('treats Object.prototype keys as orphans (not catalog facts)', () => {
        const catalog = parseFactsCatalog({
            schemaVersion: 1,
            facts: { 'repos.root': { valueType: 'path' } },
        });
        // `in` would match prototype; Object.hasOwn must not.
        expect(findOrphanNeeds(['toString'], catalog)).toEqual(['toString']);
        expect(findOrphanNeeds(['__proto__', 'constructor'], catalog)).toEqual([
            '__proto__',
            'constructor',
        ]);
    });
});
