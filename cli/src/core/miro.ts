import { StoryMap } from './story-map-parser';

// Layout constants — Miro enforces min card width of 256 and auto-calculates card height (~94dp+)
const CARD_W = 260;
const CARD_H = 100;    // layout spacing only — not sent to API (Miro auto-calculates)
const STORY_H = 150;   // layout spacing only — generous to avoid overlap with auto-sized cards
const COL_GAP = 20;
const COL_W = CARD_W + COL_GAP;   // 280
const ROW_GAP = 15;
const PADDING = 40;
const TITLE_H = 50;
const SWIMLANE_H = 40;
const SWIMLANE_GAP = 30;   // extra vertical space before each swimlane separator
const ACTIVITY_GAP = 40;   // horizontal gap between activity groups

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

    // Guard: return empty layout when there are no activities
    if (activities.length === 0) {
        return { frameWidth: 0, frameHeight: 0, items: [] };
    }

    // USM layout: each Task gets its own column. Activities span across their Tasks.
    // Stories go below their corresponding Task column.
    // Activity groups are separated by ACTIVITY_GAP for visual distinction.

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

    // Max stories in any single task column per release (determines row height)
    const maxStoriesPerRelease: Map<string, number> = new Map();
    for (const release of releases) {
        let max = 0;
        for (const activity of activities) {
            for (const task of activity.tasks) {
                const count = task.stories.filter(s => s.release === release).length;
                if (count > max) max = count;
            }
        }
        maxStoriesPerRelease.set(release, max);
    }

    // Precompute activity group widths and X offsets
    // Each group: numTasks * COL_W - COL_GAP, separated by ACTIVITY_GAP
    const activityGroupWidths = activities.map(a => Math.max(1, a.tasks.length) * COL_W - COL_GAP);
    const contentWidth = activityGroupWidths.reduce((sum, w) => sum + w, 0)
        + (activities.length - 1) * ACTIVITY_GAP;

    // Frame dimensions
    const frameWidth = PADDING * 2 + contentWidth;

    const releaseSectionH = releases.reduce((sum, r) => {
        const maxStories = maxStoriesPerRelease.get(r) ?? 0;
        return sum + SWIMLANE_GAP + SWIMLANE_H + maxStories * (STORY_H + ROW_GAP);
    }, 0);
    // Activity row + Task row + release sections
    const frameHeight = PADDING + TITLE_H + CARD_H + ROW_GAP + CARD_H + ROW_GAP + releaseSectionH + PADDING;

    // Frame top-left (frame centered at canvas origin)
    const frameLeft = -frameWidth / 2;
    const frameTop = -frameHeight / 2;

    const items: LayoutItem[] = [];

    // Fixed Y positions
    const activityY = frameTop + PADDING + TITLE_H + CARD_H / 2;
    const taskY = activityY + CARD_H / 2 + ROW_GAP + CARD_H / 2;

    // Build columns with ACTIVITY_GAP between groups
    // Track the X offset for each task column (needed for stories later)
    const taskColXPositions: number[] = []; // one per task across all activities
    let groupLeftX = PADDING; // running X from frame left edge

    for (let ai = 0; ai < activities.length; ai++) {
        const activity = activities[ai];
        const numTaskCols = Math.max(1, activity.tasks.length);
        const groupWidth = activityGroupWidths[ai];

        // Activity card — spans its task columns
        const activityX = frameLeft + groupLeftX + groupWidth / 2;

        items.push({
            kind: 'activity',
            title: activity.title,
            x: activityX,
            y: activityY,
            width: groupWidth,
            height: CARD_H,
            color: '#ffdc4a',
        });

        // Task cards — one per column within this group
        for (let j = 0; j < activity.tasks.length; j++) {
            const colX = frameLeft + groupLeftX + j * COL_W + CARD_W / 2;
            taskColXPositions.push(colX);

            items.push({
                kind: 'task',
                title: activity.tasks[j].title,
                x: colX,
                y: taskY,
                width: CARD_W,
                height: CARD_H,
                color: '#659df2',
            });
        }

        // Activity with 0 tasks: placeholder column (no task card, but reserve X space)
        if (activity.tasks.length === 0) {
            taskColXPositions.push(frameLeft + groupLeftX + CARD_W / 2);
        }

        groupLeftX += groupWidth + ACTIVITY_GAP;
    }

    // Swimlanes and stories — each story goes below its Task column
    let swimlaneTop = frameTop + PADDING + TITLE_H + CARD_H + ROW_GAP + CARD_H + ROW_GAP;

    for (const release of releases) {
        const maxStories = maxStoriesPerRelease.get(release) ?? 0;

        // Extra gap before each swimlane
        swimlaneTop += SWIMLANE_GAP;
        const swimlaneCenterY = swimlaneTop + SWIMLANE_H / 2;

        items.push({
            kind: 'swimlane',
            title: release,
            x: 0,
            y: swimlaneCenterY,
            width: frameWidth,
            height: SWIMLANE_H,
        });

        // Stories per task column (using precomputed X positions)
        let colIdx = 0;
        for (const activity of activities) {
            if (activity.tasks.length === 0) {
                colIdx++;
                continue;
            }
            for (const task of activity.tasks) {
                const colX = taskColXPositions[colIdx];
                const releaseStories = task.stories.filter(s => s.release === release);

                for (let k = 0; k < releaseStories.length; k++) {
                    const storyY = swimlaneTop + SWIMLANE_H + k * (STORY_H + ROW_GAP) + STORY_H / 2;
                    items.push({
                        kind: 'story',
                        title: releaseStories[k].title,
                        x: colX,
                        y: storyY,
                        width: CARD_W,
                        height: STORY_H,
                        color: '#ffffff',
                    });
                }

                colIdx++;
            }
        }

        swimlaneTop += SWIMLANE_H + maxStories * (STORY_H + ROW_GAP);
    }

    return { frameWidth, frameHeight, items };
}

// ─── REST Client ─────────────────────────────────────────────────────────────

const MIRO_BASE = 'https://api.miro.com/v2';

export interface MiroConfig {
    token: string;
    boardId: string;
}

async function miroRequest(config: MiroConfig, method: string, path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(`${MIRO_BASE}${path}`, {
            method,
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Miro API ${method} ${path} → ${response.status}: ${text}`);
        }

        if (response.status === 204) return null;
        return response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

async function createFrame(config: MiroConfig, title: string, width: number, height: number): Promise<string> {
    // Position far from origin to avoid nesting inside any existing frame at (0,0)
    const data = await miroRequest(config, 'POST', `/boards/${encodeURIComponent(config.boardId)}/frames`, {
        data: { title, format: 'custom', type: 'freeform' },
        style: { fillColor: '#f5f6f8' },
        position: { x: 50000, y: 0, origin: 'center' },
        geometry: { width, height },
    }) as { id: string };
    if (!data?.id) throw new Error('Miro API returned frame without id');
    return data.id;
}

async function createCard(config: MiroConfig, frameId: string, item: LayoutItem, offsetX: number, offsetY: number): Promise<string> {
    const data = await miroRequest(config, 'POST', `/boards/${encodeURIComponent(config.boardId)}/cards`, {
        data: { title: item.title },
        style: { cardTheme: item.color },
        position: { x: item.x + offsetX, y: item.y + offsetY, origin: 'center' },
        geometry: { width: item.width },  // height is read-only, auto-calculated by Miro
        parent: { id: frameId },
    }) as { id: string };
    return data.id;
}

async function createText(config: MiroConfig, frameId: string, item: LayoutItem, offsetX: number, offsetY: number): Promise<string> {
    const data = await miroRequest(config, 'POST', `/boards/${encodeURIComponent(config.boardId)}/texts`, {
        data: { content: `<b>${item.title}</b>` },
        style: { fillColor: '#e8e8e8', textAlign: 'left', fontSize: '14' },
        position: { x: item.x + offsetX, y: item.y + offsetY, origin: 'center' },
        geometry: { width: item.width },  // height not supported for text items
        parent: { id: frameId },
    }) as { id: string };
    return data.id;
}

async function deleteItem(config: MiroConfig, itemId: string): Promise<void> {
    await miroRequest(config, 'DELETE', `/boards/${encodeURIComponent(config.boardId)}/items/${itemId}`);
}

async function listFrameCards(config: MiroConfig, frameId: string): Promise<{ id: string; title: string }[]> {
    const results: { id: string; title: string }[] = [];
    let cursor: string | undefined;

    do {
        const url = `/boards/${encodeURIComponent(config.boardId)}/items?parent_item_id=${frameId}&type=card&limit=50${cursor ? `&cursor=${cursor}` : ''}`;
        const data = await miroRequest(config, 'GET', url) as {
            data: { id: string; data?: { title?: string } }[];
            cursor?: string;
        };

        for (const item of data.data || []) {
            results.push({ id: item.id, title: stripHtml(item.data?.title || '') });
        }

        cursor = data.cursor;
    } while (cursor);

    return results;
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
}

// ─── Sync orchestration ───────────────────────────────────────────────────────

export interface SyncResult {
    frameId: string;
    created: number;
    updated: number;
    deleted: number;
}

export async function syncToMiro(config: MiroConfig, storyMap: StoryMap, existingFrameId?: string): Promise<SyncResult> {
    const { frameWidth, frameHeight, items } = computeLayout(storyMap);

    // Child items use coordinates relative to the frame's top-left corner.
    // Layout engine computes coordinates centered at (0,0), so offset by half the frame dimensions.
    const offsetX = frameWidth / 2;
    const offsetY = frameHeight / 2;

    let frameId = existingFrameId;
    let created = 0;
    let updated = 0;
    let deleted = 0;

    if (!frameId) {
        // First sync: create frame + all items
        frameId = await createFrame(config, `Story Map — ${storyMap.project}`, frameWidth, frameHeight);

        for (const item of items) {
            if (item.kind === 'swimlane') {
                await createText(config, frameId, item, offsetX, offsetY);
            } else {
                await createCard(config, frameId, item, offsetX, offsetY);
            }
            created++;
        }
    } else {
        // Subsequent sync: diff and update
        const existingCards = await listFrameCards(config, frameId);
        const existingByTitle = new Map(existingCards.map(c => [c.title, c.id]));

        const newCardTitles = new Set(
            items.filter(i => i.kind !== 'swimlane').map(i => i.title)
        );

        // Delete cards no longer in the map
        for (const existing of existingCards) {
            if (!newCardTitles.has(existing.title)) {
                await deleteItem(config, existing.id);
                deleted++;
            }
        }

        // Create or update cards from new layout
        for (const item of items) {
            // Note: swimlane text items are not diffed on re-sync.
            // Renamed or removed releases require deleting and re-creating the frame manually.
            // Full text-item diffing is a known limitation to address in a future iteration.
            if (item.kind === 'swimlane') continue;

            if (!existingByTitle.has(item.title)) {
                await createCard(config, frameId, item, offsetX, offsetY);
                created++;
            }
            // matched cards already have the correct title — no update needed
        }
    }

    return { frameId, created, updated, deleted };
}
