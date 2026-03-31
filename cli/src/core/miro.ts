import { StoryMap } from './story-map-parser';

// Layout constants
const CARD_W = 220;
const CARD_H = 60;
const STORY_H = 80;
const COL_GAP = 20;
const COL_W = CARD_W + COL_GAP;   // 240
const ROW_GAP = 10;
const PADDING = 30;
const TITLE_H = 50;
const SWIMLANE_H = 35;

export type ItemKind = 'activity' | 'task' | 'story' | 'swimlane';

export interface LayoutItem {
    kind: ItemKind;
    title: string;
    x: number;       // canvas center x (absolute)
    y: number;       // canvas center y (absolute)
    width: number;
    height: number;
    color?: string;  // undefined for swimlane text items
}

export interface Layout {
    frameWidth: number;
    frameHeight: number;
    items: LayoutItem[];
}

function sortReleases(releases: string[]): string[] {
    return [...releases].sort((a, b) => {
        if (a === 'MVP' && b !== 'MVP') return -1;
        if (b === 'MVP' && a !== 'MVP') return 1;
        if (a === 'Backlog' && b !== 'Backlog') return 1;
        if (b === 'Backlog' && a !== 'Backlog') return -1;
        return a.localeCompare(b);
    });
}

export function computeLayout(storyMap: StoryMap): Layout {
    const { activities } = storyMap;
    const numActivities = activities.length;

    // Collect all unique releases (ordered)
    const releaseSet = new Set<string>();
    for (const activity of activities) {
        for (const task of activity.tasks) {
            for (const story of task.stories) {
                releaseSet.add(story.release);
            }
        }
    }
    const releases = sortReleases([...releaseSet]);

    // Compute max tasks per activity (for uniform task section height)
    const maxTasks = Math.max(0, ...activities.map(a => a.tasks.length));

    // Compute max stories per release across all activities
    // For each release, find the max stories in any single activity column
    const maxStoriesPerRelease: Map<string, number> = new Map();
    for (const release of releases) {
        let max = 0;
        for (const activity of activities) {
            let count = 0;
            for (const task of activity.tasks) {
                count += task.stories.filter(s => s.release === release).length;
            }
            if (count > max) max = count;
        }
        maxStoriesPerRelease.set(release, max);
    }

    // frameWidth
    const frameWidth = PADDING * 2 + numActivities * COL_W - COL_GAP;

    // frameHeight = PADDING + TITLE_H + CARD_H (activity) + ROW_GAP + maxTasks*(CARD_H+ROW_GAP)
    //             + sum_releases(SWIMLANE_H + maxStoriesInRelease*(STORY_H+ROW_GAP))
    //             + PADDING
    const taskSectionH = maxTasks * (CARD_H + ROW_GAP);
    const releaseSectionH = releases.reduce((sum, r) => {
        const maxStories = maxStoriesPerRelease.get(r) ?? 0;
        return sum + SWIMLANE_H + maxStories * (STORY_H + ROW_GAP);
    }, 0);
    const frameHeight = PADDING + TITLE_H + CARD_H + ROW_GAP + taskSectionH + releaseSectionH + PADDING;

    // Frame top-left
    const frameLeft = -frameWidth / 2;
    const frameTop = -frameHeight / 2;

    const items: LayoutItem[] = [];

    // Activity Y (center)
    const activityY = frameTop + PADDING + TITLE_H + CARD_H / 2;

    for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];

        // Column center X
        const colX = frameLeft + PADDING + i * COL_W + CARD_W / 2;

        // Activity card
        items.push({
            kind: 'activity',
            title: activity.title,
            x: colX,
            y: activityY,
            width: CARD_W,
            height: CARD_H,
            color: '#ffdc4a',
        });

        // Task cards
        for (let j = 0; j < activity.tasks.length; j++) {
            const task = activity.tasks[j];
            const taskY = activityY + CARD_H / 2 + ROW_GAP + j * (CARD_H + ROW_GAP) + CARD_H / 2;

            items.push({
                kind: 'task',
                title: task.title,
                x: colX,
                y: taskY,
                width: CARD_W,
                height: CARD_H,
                color: '#659df2',
            });
        }
    }

    // Y position after tasks section (bottom of task section)
    // activityY + CARD_H/2 + ROW_GAP + maxTasks*(CARD_H+ROW_GAP) gives the bottom of last task
    // but we want the top of the swimlane section
    let swimlaneTop = frameTop + PADDING + TITLE_H + CARD_H + ROW_GAP + taskSectionH;

    for (const release of releases) {
        const maxStories = maxStoriesPerRelease.get(release) ?? 0;
        const swimlaneCenterY = swimlaneTop + SWIMLANE_H / 2;

        // Swimlane label — full-width, centered at x=0
        items.push({
            kind: 'swimlane',
            title: release,
            x: 0,
            y: swimlaneCenterY,
            width: frameWidth,
            height: SWIMLANE_H,
            // no color
        });

        // Story cards per activity column
        for (let i = 0; i < activities.length; i++) {
            const activity = activities[i];
            const colX = frameLeft + PADDING + i * COL_W + CARD_W / 2;

            // Collect stories for this release in this activity (ordered by task, then story)
            const releaseStories: string[] = [];
            for (const task of activity.tasks) {
                for (const story of task.stories) {
                    if (story.release === release) {
                        releaseStories.push(story.title);
                    }
                }
            }

            for (let k = 0; k < releaseStories.length; k++) {
                const storyY = swimlaneTop + SWIMLANE_H + k * (STORY_H + ROW_GAP) + STORY_H / 2;
                items.push({
                    kind: 'story',
                    title: releaseStories[k],
                    x: colX,
                    y: storyY,
                    width: CARD_W,
                    height: STORY_H,
                    color: '#ffffff',
                });
            }
        }

        swimlaneTop += SWIMLANE_H + maxStories * (STORY_H + ROW_GAP);
    }

    return { frameWidth, frameHeight, items };
}
