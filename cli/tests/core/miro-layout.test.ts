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

// New layout: column = Task. Total task columns = 3 (1 + 2)
// CARD_W=260, COL_W=280, PADDING=40
// frameWidth = 40*2 + 3*280 - 20 = 900
// Activity 1 spans 1 col (width=260), Activity 2 spans 2 cols (width=540)

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

    it('activity with 1 task has same x as its task (centered over single column)', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act1 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 1')!;
        const task11 = items.find(i => i.kind === 'task' && i.title === 'Task 1.1')!;
        expect(act1.x).toBe(task11.x);
    });

    it('activity with 2 tasks is centered between its task columns', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act2 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 2')!;
        const task21 = items.find(i => i.kind === 'task' && i.title === 'Task 2.1')!;
        const task22 = items.find(i => i.kind === 'task' && i.title === 'Task 2.2')!;
        // Activity center should be midpoint of its task columns
        expect(act2.x).toBe((task21.x + task22.x) / 2);
    });

    it('activity with 2 tasks is wider than activity with 1 task', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act1 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 1')!;
        const act2 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 2')!;
        expect(act2.width).toBeGreaterThan(act1.width);
    });

    it('activities in different positions have different x values', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act1 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 1')!;
        const act2 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 2')!;
        expect(act1.x).not.toBe(act2.x);
    });

    it('frame width scales with total number of task columns', () => {
        const { frameWidth } = computeLayout(SIMPLE_MAP);
        // 3 task columns
        const oneTask = { ...SIMPLE_MAP, activities: [SIMPLE_MAP.activities[0]] };
        const { frameWidth: oneWidth } = computeLayout(oneTask);
        // 1 task column
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

    it('stories are placed below their corresponding task column', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        // Story A belongs to Task 1.1 → same column x
        const task11 = items.find(i => i.kind === 'task' && i.title === 'Task 1.1')!;
        const storyA = items.find(i => i.kind === 'story' && i.title === 'Story A')!;
        expect(storyA.x).toBe(task11.x);

        // Story C belongs to Task 2.1 → same column x
        const task21 = items.find(i => i.kind === 'task' && i.title === 'Task 2.1')!;
        const storyC = items.find(i => i.kind === 'story' && i.title === 'Story C')!;
        expect(storyC.x).toBe(task21.x);
    });

    it('MVP swimlane Y is less than Release 2 swimlane Y (canvas coordinates)', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const mvp = items.find(i => i.kind === 'swimlane' && i.title === 'MVP')!;
        const r2 = items.find(i => i.kind === 'swimlane' && i.title === 'Release 2')!;
        expect(mvp.y).toBeLessThan(r2.y);
    });

    it('first activity Y is correct (frameTop + PADDING + TITLE_H + CARD_H/2)', () => {
        const { items, frameHeight } = computeLayout(SIMPLE_MAP);
        const act1 = items.find(i => i.kind === 'activity' && i.title === 'Actividad 1')!;
        const expectedY = -frameHeight / 2 + 40 + 50 + 50; // PADDING(40) + TITLE_H(50) + CARD_H/2(50)
        expect(act1.y).toBe(expectedY);
    });

    it('handles empty activities gracefully', () => {
        const emptyMap: StoryMap = { project: 'Empty', goal: '', activities: [] };
        const { frameWidth, frameHeight, items } = computeLayout(emptyMap);
        expect(frameWidth).toBeGreaterThanOrEqual(0);
        expect(frameHeight).toBeGreaterThanOrEqual(0);
        expect(items).toHaveLength(0);
    });
});
