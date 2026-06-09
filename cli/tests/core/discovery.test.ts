import { discoverSkills, discoverWorkflows, readArtifactDescription, SKILLS_DIR, WORKFLOWS_DIR } from '../../src/core/discovery';
import path from 'path';
import fs from 'fs';

jest.mock('fs');

// Explicit roots derived from the exported constants — avoids calling contentRoots()
// (which would hit the real/mocked fs for registries config) inside unit tests.
const SKILLS_ROOT = path.dirname(SKILLS_DIR);   // …/registry
const WORKFLOWS_ROOT = path.dirname(WORKFLOWS_DIR); // …/registry

describe('Artifact Discovery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('discoverSkills', () => {
        it('should return a list of skill directories that contain a SKILL.md', () => {
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
                if (p === SKILLS_DIR) return true;
                if (p.endsWith('SKILL.md')) return true;
                return false;
            });
            (fs.readdirSync as jest.Mock).mockReturnValue([
                { name: 'my-skill', isDirectory: () => true },
                { name: 'another-skill', isDirectory: () => true },
                { name: 'readme.txt', isDirectory: () => false },
            ]);

            const skills = discoverSkills([SKILLS_ROOT]);

            expect(skills).toHaveLength(2);
            expect(skills[0].name).toBe('my-skill');
            expect(skills[1].name).toBe('another-skill');
            expect(skills[0].description).toBe('');
        });

        it('should return an empty array if the skills directory does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const skills = discoverSkills([SKILLS_ROOT]);

            expect(skills).toEqual([]);
        });

        it('should skip skill directories without a SKILL.md', () => {
            (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
                if (p === SKILLS_DIR) return true;
                // This skill has no SKILL.md
                if (p.endsWith('SKILL.md')) return false;
                return false;
            });
            (fs.readdirSync as jest.Mock).mockReturnValue([
                { name: 'broken-skill', isDirectory: () => true },
            ]);

            const skills = discoverSkills([SKILLS_ROOT]);
            expect(skills).toEqual([]);
        });
    });

    describe('discoverWorkflows', () => {
        it('should return a list of .md files in the workflows directory', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readdirSync as jest.Mock).mockReturnValue([
                { name: 'deploy.md', isDirectory: () => false },
                { name: 'ci.md', isDirectory: () => false },
                { name: 'readme.txt', isDirectory: () => false },
            ]);

            const workflows = discoverWorkflows([WORKFLOWS_ROOT]);

            expect(workflows).toHaveLength(2);
            expect(workflows[0].name).toBe('deploy');
            expect(workflows[1].name).toBe('ci');
            expect(workflows[0].description).toBe('');
        });

        it('should return an empty array if the workflows directory does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const workflows = discoverWorkflows([WORKFLOWS_ROOT]);
            expect(workflows).toEqual([]);
        });
    });

    describe('readArtifactDescription', () => {
        it('extracts the description field from YAML frontmatter', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue(
                '---\nname: my-skill\ndescription: Does a useful thing\n---\n\n# Body\n'
            );
            expect(readArtifactDescription('/any/SKILL.md')).toBe('Does a useful thing');
        });

        it('strips surrounding quotes from the description', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue(
                '---\ndescription: "Quoted desc"\n---\n'
            );
            expect(readArtifactDescription('/any/SKILL.md')).toBe('Quoted desc');
        });

        it('returns empty string when there is no frontmatter', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue('# Just a heading\n');
            expect(readArtifactDescription('/any/SKILL.md')).toBe('');
        });

        it('returns empty string when description is absent', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue('---\nname: x\n---\n');
            expect(readArtifactDescription('/any/SKILL.md')).toBe('');
        });

        it('returns empty string when the file cannot be read', () => {
            (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
            expect(readArtifactDescription('/missing/SKILL.md')).toBe('');
        });

        it('returns empty string for a block scalar description indicator', () => {
            (fs.readFileSync as jest.Mock).mockReturnValue('---\ndescription: >-\n  actual text\n---\n');
            expect(readArtifactDescription('/any/SKILL.md')).toBe('');
        });
    });
});
