import { computeLayout } from '../../src/core/miro';
import { StoryMap } from '../../src/core/story-map-parser';

const SIMPLE_MAP: StoryMap = {
    project: 'Test Project',
    goal: 'Test goal',
    activities: [
        {
            title: 'Actividad 1',
            tasks: [
                {
                    title: 'Task 1.1',
                    stories: [
                        { release: 'MVP', title: 'Story A' },
                        { release: 'Release 2', title: 'Story B' },
                    ],
                },
            ],
        },
        {
            title: 'Actividad 2',
            tasks: [
                {
                    title: 'Task 2.1',
                    stories: [
                        { release: 'MVP', title: 'Story C' },
                    ],
                },
                {
                    title: 'Task 2.2',
                    stories: [],
                },
            ],
        },
    ],
};

describe('computeLayout', () => {
    it('returns one card per activity', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const activities = items.filter(i => i.kind === 'activity');
        expect(activities).toHaveLength(2);
    });

    it('returns one card per task', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const tasks = items.filter(i => i.kind === 'task');
        expect(tasks).toHaveLength(3);
    });

    it('returns one card per story', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const stories = items.filter(i => i.kind === 'story');
        expect(stories).toHaveLength(3);
    });

    it('returns one swimlane label per unique release', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const swimlanes = items.filter(i => i.kind === 'swimlane');
        expect(swimlanes).toHaveLength(2);
        expect(swimlanes.map(s => s.title)).toContain('MVP');
        expect(swimlanes.map(s => s.title)).toContain('Release 2');
    });

    it('activities in same column as their tasks (same x)', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act1 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 1')!;
        const task11 = items.find(i => i.kind === 'task' && i.title === 'Task 1.1')!;
        expect(act1.x).toBe(task11.x);
    });

    it('activities in different columns have different x values', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act1 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 1')!;
        const act2 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 2')!;
        expect(act1.x).not.toBe(act2.x);
    });

    it('frame width scales with number of activities', () => {
        const { frameWidth } = computeLayout(SIMPLE_MAP);
        const oneActivity = { ...SIMPLE_MAP, activities: [SIMPLE_MAP.activities[0]] };
        const { frameWidth: oneWidth } = computeLayout(oneActivity);
        expect(frameWidth).toBeGreaterThan(oneWidth);
    });

    it('frame height is positive', () => {
        const { frameHeight } = computeLayout(SIMPLE_MAP);
        expect(frameHeight).toBeGreaterThan(0);
    });

    it('assigns correct colors by kind', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act = items.find(i => i.kind === 'activity')!;
        const task = items.find(i => i.kind === 'task')!;
        const story = items.find(i => i.kind === 'story')!;
        const swimlane = items.find(i => i.kind === 'swimlane')!;
        expect(act.color).toBe('#ffdc4a');
        expect(task.color).toBe('#659df2');
        expect(story.color).toBe('#ffffff');
        expect(swimlane.color).toBeUndefined();
    });

    it('MVP swimlane appears before Release 2', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const swimlanes = items.filter(i => i.kind === 'swimlane');
        const mvpIdx = swimlanes.findIndex(s => s.title === 'MVP');
        const r2Idx = swimlanes.findIndex(s => s.title === 'Release 2');
        expect(mvpIdx).toBeLessThan(r2Idx);
    });
});
