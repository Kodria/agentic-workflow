import { discoverSkills, discoverWorkflows, discoverProcesses, SKILLS_DIR, WORKFLOWS_DIR, PROCESSES_FILE } from '../../src/core/discovery';
import fs from 'fs';

jest.mock('fs');

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

            const skills = discoverSkills();

            expect(skills).toHaveLength(2);
            expect(skills[0].name).toBe('my-skill');
            expect(skills[1].name).toBe('another-skill');
        });

        it('should return an empty array if the skills directory does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const skills = discoverSkills();

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

            const skills = discoverSkills();
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

            const workflows = discoverWorkflows();

            expect(workflows).toHaveLength(2);
            expect(workflows[0].name).toBe('deploy');
            expect(workflows[1].name).toBe('ci');
        });

        it('should return an empty array if the workflows directory does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const workflows = discoverWorkflows();
            expect(workflows).toEqual([]);
        });
    });

    describe('discoverProcesses', () => {
        it('should parse the processes.json file and return a list of processes', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([
                {
                    name: 'full-dev-flow',
                    description: 'Complete development workflow',
                    skills: ['brainstorming', 'writing-plans'],
                    workflows: ['executing-plans']
                }
            ]));

            const processes = discoverProcesses();

            expect(processes).toHaveLength(1);
            expect(processes[0].name).toBe('full-dev-flow');
            expect(processes[0].skills).toEqual(['brainstorming', 'writing-plans']);
            expect(processes[0].workflows).toEqual(['executing-plans']);
        });

        it('should return an empty array if processes.json does not exist', () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const processes = discoverProcesses();
            expect(processes).toEqual([]);
        });
    });
});
