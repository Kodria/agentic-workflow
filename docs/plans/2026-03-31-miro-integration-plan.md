# Miro Integration — `awm miro sync` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `awm miro sync <story-map.md>` command to the CLI that reads the story map markdown and creates/updates a visual Story Map frame in a Miro board via REST API.

**Architecture:** Three modules — `story-map-parser.ts` (markdown → typed tree), `miro.ts` (layout engine + REST client), and a new `miro sync` command in `index.ts`. Config is read from `.env` in the cwd. Frame ID is persisted in the story-map frontmatter after first sync.

**Tech Stack:** TypeScript 5.x, Node.js 18+ (native fetch), Commander.js, jest + ts-jest for tests. No new dependencies.

---

## Context

Read the design doc before starting: `docs/plans/2026-03-31-miro-integration-design.md`

**Existing pattern to follow:**
- All commands are defined as `.command()` chains in `cli/src/index.ts`
- Core logic lives in `cli/src/core/`
- Tests live in `cli/tests/core/` and follow the `jest.mock('fs')` pattern
- Build: `cd cli && npm run build` (compiles `src/` → `dist/`)
- Test: `cd cli && npm test`

**Story map markdown structure to parse:**
```markdown
---
project: Portal B2B
miro_frame_id: "3458764665957846182"   ← added after first sync
---

# Story Map — Portal B2B

## Goal
> Why this product exists

## Backbone

### 🟡 Actividad 1

#### 🔵 Task: Tarea 1.1
- **[MVP]** Story title
- **[Release 2]** Another story

### 🟡 Actividad 2
...
```

**Miro REST API base:** `https://api.miro.com`
**Auth header:** `Authorization: Bearer {MIRO_TOKEN}`

**Card colors by level:**
| Level | cardTheme |
|-------|-----------|
| Activity (🟡) | `#ffdc4a` |
| Task (🔵) | `#659df2` |
| Story (⬜) | `#ffffff` |

---

## Task 1: story-map-parser.ts

**Files:**
- Create: `cli/src/core/story-map-parser.ts`
- Create: `cli/tests/core/story-map-parser.test.ts`

### Step 1: Write the failing tests

Create `cli/tests/core/story-map-parser.test.ts`:

```typescript
import { parseStoryMap, updateMiroFrameId } from '../../src/core/story-map-parser';

const SAMPLE_MARKDOWN = `---
project: Portal B2B
---

# Story Map — Portal B2B

## Goal
> Permitir a proveedores gestionar su relación con Cencosud

## Personas

### Proveedor
- **Rol:** Externo

## Backbone

### 🟡 Acceder al portal

#### 🔵 Task: Iniciar sesión
- **[MVP]** Como proveedor, quiero iniciar sesión con mi usuario y contraseña
- **[Release 2]** Como proveedor, quiero autenticarme con SSO

#### 🔵 Task: Seleccionar país y UN
- **[MVP]** Como proveedor, quiero seleccionar mi país al ingresar

### 🟡 Consultar mis datos

#### 🔵 Task: Ver dashboard
- **[MVP]** Como proveedor, quiero ver mis indicadores principales

## Release Summary

| Release | Stories |
|---------|---------|
| MVP | 3 |

## Changelog

- [2026-03-31] Sesión 1
`;

const MARKDOWN_WITH_FRAME_ID = `---
project: Portal B2B
miro_frame_id: "existing-id"
---

# Story Map — Portal B2B
`;

describe('parseStoryMap', () => {
    it('extracts project name from frontmatter', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.project).toBe('Portal B2B');
    });

    it('extracts goal text stripping the > prefix', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.goal).toBe('Permitir a proveedores gestionar su relación con Cencosud');
    });

    it('returns undefined miro_frame_id when not in frontmatter', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.miro_frame_id).toBeUndefined();
    });

    it('extracts miro_frame_id from frontmatter when present', () => {
        const result = parseStoryMap(MARKDOWN_WITH_FRAME_ID);
        expect(result.miro_frame_id).toBe('existing-id');
    });

    it('extracts activities in order', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.activities).toHaveLength(2);
        expect(result.activities[0].title).toBe('Acceder al portal');
        expect(result.activities[1].title).toBe('Consultar mis datos');
    });

    it('extracts tasks under each activity', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.activities[0].tasks).toHaveLength(2);
        expect(result.activities[0].tasks[0].title).toBe('Iniciar sesión');
        expect(result.activities[0].tasks[1].title).toBe('Seleccionar país y UN');
    });

    it('extracts stories with their release labels', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        const stories = result.activities[0].tasks[0].stories;
        expect(stories).toHaveLength(2);
        expect(stories[0]).toEqual({ release: 'MVP', title: 'Como proveedor, quiero iniciar sesión con mi usuario y contraseña' });
        expect(stories[1]).toEqual({ release: 'Release 2', title: 'Como proveedor, quiero autenticarme con SSO' });
    });

    it('ignores content outside Backbone section', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        // Release Summary and Changelog are not parsed as activities
        expect(result.activities.every(a => !a.title.includes('Release') && !a.title.includes('Changelog'))).toBe(true);
    });
});

describe('updateMiroFrameId', () => {
    it('adds miro_frame_id to existing frontmatter', () => {
        const result = updateMiroFrameId(SAMPLE_MARKDOWN, 'new-frame-123');
        expect(result).toContain('miro_frame_id: "new-frame-123"');
    });

    it('replaces existing miro_frame_id', () => {
        const result = updateMiroFrameId(MARKDOWN_WITH_FRAME_ID, 'new-frame-456');
        expect(result).toContain('miro_frame_id: "new-frame-456"');
        expect(result).not.toContain('existing-id');
    });

    it('preserves the rest of the frontmatter and body', () => {
        const result = updateMiroFrameId(SAMPLE_MARKDOWN, 'new-frame-123');
        expect(result).toContain('project: Portal B2B');
        expect(result).toContain('# Story Map — Portal B2B');
    });
});
```

### Step 2: Run tests — verify they fail

```bash
cd cli && npm test -- --testPathPattern=story-map-parser
```

Expected: FAIL — `Cannot find module '../../src/core/story-map-parser'`

### Step 3: Implement story-map-parser.ts

Create `cli/src/core/story-map-parser.ts`:

```typescript
export interface Story {
    release: string;
    title: string;
}

export interface Task {
    title: string;
    stories: Story[];
}

export interface Activity {
    title: string;
    tasks: Task[];
}

export interface StoryMap {
    project: string;
    goal: string;
    miro_frame_id?: string;
    activities: Activity[];
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: content };

    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && value) meta[key] = value;
    }

    return { meta, body: match[2] };
}

function extractBackbone(body: string): string {
    const match = body.match(/## Backbone\n([\s\S]*?)(?=\n## |$)/);
    return match ? match[1].trim() : '';
}

function parseBackbone(backbone: string): Activity[] {
    const activities: Activity[] = [];
    const activityBlocks = backbone.split(/(?=^### 🟡 )/m).filter(Boolean);

    for (const block of activityBlocks) {
        const lines = block.split('\n');
        const activityMatch = lines[0].match(/^### 🟡 (.+)$/);
        if (!activityMatch) continue;

        const activity: Activity = { title: activityMatch[1].trim(), tasks: [] };
        const taskContent = lines.slice(1).join('\n');
        const taskBlocks = taskContent.split(/(?=^#### 🔵 Task: )/m).filter(s => s.trim());

        for (const taskBlock of taskBlocks) {
            const taskLines = taskBlock.split('\n');
            const taskMatch = taskLines[0].match(/^#### 🔵 Task: (.+)$/);
            if (!taskMatch) continue;

            const task: Task = { title: taskMatch[1].trim(), stories: [] };

            for (const line of taskLines.slice(1)) {
                const storyMatch = line.match(/^- \*\*\[(.+?)\]\*\* (.+)$/);
                if (storyMatch) {
                    task.stories.push({ release: storyMatch[1].trim(), title: storyMatch[2].trim() });
                }
            }

            activity.tasks.push(task);
        }

        activities.push(activity);
    }

    return activities;
}

export function parseStoryMap(content: string): StoryMap {
    const { meta, body } = parseFrontmatter(content);

    const titleMatch = body.match(/^# Story Map — (.+)$/m);
    const project = meta['project'] || (titleMatch ? titleMatch[1].trim() : 'Unknown');

    const goalMatch = body.match(/## Goal\n>\s*(.+)/);
    const goal = goalMatch ? goalMatch[1].trim() : '';

    const backbone = extractBackbone(body);
    const activities = parseBackbone(backbone);

    return {
        project,
        goal,
        miro_frame_id: meta['miro_frame_id'] || undefined,
        activities,
    };
}

export function updateMiroFrameId(content: string, frameId: string): string {
    const match = content.match(/^(---\n)([\s\S]*?)(\n---\n)([\s\S]*)$/);
    if (!match) {
        return `---\nmiro_frame_id: "${frameId}"\n---\n${content}`;
    }

    const [, open, frontmatter, close, body] = match;

    if (frontmatter.includes('miro_frame_id:')) {
        const updated = frontmatter.replace(/miro_frame_id:.*/, `miro_frame_id: "${frameId}"`);
        return `${open}${updated}${close}${body}`;
    }

    return `${open}${frontmatter}\nmiro_frame_id: "${frameId}"${close}${body}`;
}
```

### Step 4: Run tests — verify they pass

```bash
cd cli && npm test -- --testPathPattern=story-map-parser
```

Expected: PASS — 10 tests passing

### Step 5: Commit

```bash
cd cli && git add src/core/story-map-parser.ts tests/core/story-map-parser.test.ts
git commit -m "feat: add story-map markdown parser"
```

---

## Task 2: miro.ts — Layout Engine

**Files:**
- Create: `cli/src/core/miro.ts`
- Create: `cli/tests/core/miro-layout.test.ts`

The layout engine is a pure function: `StoryMap → CardItem[]`. No HTTP, fully testable.

### Step 1: Write the failing tests

Create `cli/tests/core/miro-layout.test.ts`:

```typescript
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
        expect(swimlanes).toHaveLength(2); // MVP and Release 2
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

    it('frame height includes space for all releases', () => {
        const { frameHeight } = computeLayout(SIMPLE_MAP);
        expect(frameHeight).toBeGreaterThan(0);
    });

    it('assigns correct colors by kind', () => {
        const { items } = computeLayout(SIMPLE_MAP);
        const act = items.find(i => i.kind === 'activity')!;
        const task = items.find(i => i.kind === 'task')!;
        const story = items.find(i => i.kind === 'story')!;
        expect(act.color).toBe('#ffdc4a');
        expect(task.color).toBe('#659df2');
        expect(story.color).toBe('#ffffff');
    });
});
```

### Step 2: Run tests — verify they fail

```bash
cd cli && npm test -- --testPathPattern=miro-layout
```

Expected: FAIL — `Cannot find module '../../src/core/miro'`

### Step 3: Implement the layout engine in miro.ts

Create `cli/src/core/miro.ts` with the layout engine (REST client added in Task 3):

```typescript
import { StoryMap } from './story-map-parser';

// ─── Layout constants ────────────────────────────────────────────────────────
const CARD_W = 220;
const CARD_H = 60;
const STORY_H = 80;
const COL_GAP = 20;
const COL_W = CARD_W + COL_GAP;        // 240 per column
const ROW_GAP = 10;
const PADDING = 30;
const TITLE_H = 50;
const SWIMLANE_H = 35;

// ─── Types ───────────────────────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOrderedReleases(storyMap: StoryMap): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const activity of storyMap.activities) {
        for (const task of activity.tasks) {
            for (const story of task.stories) {
                if (!seen.has(story.release)) {
                    seen.add(story.release);
                    order.push(story.release);
                }
            }
        }
    }
    // Canonical order: MVP first, Backlog last, others in between
    return order.sort((a, b) => {
        if (a === 'MVP') return -1;
        if (b === 'MVP') return 1;
        if (a.toLowerCase() === 'backlog') return 1;
        if (b.toLowerCase() === 'backlog') return -1;
        return 0;
    });
}

// ─── Layout engine ───────────────────────────────────────────────────────────

export function computeLayout(storyMap: StoryMap): Layout {
    const { activities } = storyMap;
    const releases = getOrderedReleases(storyMap);

    const maxTasks = Math.max(...activities.map(a => a.tasks.length), 0);

    const maxStoriesPerRelease = releases.map(release =>
        Math.max(
            ...activities.map(a =>
                a.tasks.reduce((sum, t) => sum + t.stories.filter(s => s.release === release).length, 0)
            ),
            0
        )
    );

    // Frame dimensions
    const frameWidth = PADDING * 2 + activities.length * COL_W - COL_GAP;
    const taskSectionH = maxTasks * (CARD_H + ROW_GAP);
    const storiesSectionH = releases.reduce((acc, _, i) =>
        acc + SWIMLANE_H + maxStoriesPerRelease[i] * (STORY_H + ROW_GAP), 0
    );
    const frameHeight = PADDING + TITLE_H + (CARD_H + ROW_GAP) + taskSectionH + storiesSectionH + PADDING;

    // Frame top-left at canvas (0,0) — Miro frame position is its center
    // Items' x,y are canvas-absolute centers
    const tlX = -frameWidth / 2;
    const tlY = -frameHeight / 2;

    const items: LayoutItem[] = [];

    // Activities + Tasks
    activities.forEach((activity, i) => {
        const colCenterX = tlX + PADDING + i * COL_W + CARD_W / 2;

        // Activity card
        const actY = tlY + PADDING + TITLE_H + CARD_H / 2;
        items.push({
            kind: 'activity',
            title: activity.title,
            x: colCenterX,
            y: actY,
            width: CARD_W,
            height: CARD_H,
            color: '#ffdc4a',
        });

        // Task cards
        activity.tasks.forEach((task, j) => {
            const taskY = tlY + PADDING + TITLE_H + CARD_H + ROW_GAP + j * (CARD_H + ROW_GAP) + CARD_H / 2;
            items.push({
                kind: 'task',
                title: task.title,
                x: colCenterX,
                y: taskY,
                width: CARD_W,
                height: CARD_H,
                color: '#659df2',
            });
        });
    });

    // Swimlane labels + Story cards
    let swimlaneBaseY = tlY + PADDING + TITLE_H + CARD_H + ROW_GAP + maxTasks * (CARD_H + ROW_GAP);

    releases.forEach((release, r) => {
        const swimlaneCenterY = swimlaneBaseY + SWIMLANE_H / 2;
        items.push({
            kind: 'swimlane',
            title: release,
            x: 0, // horizontally centered in frame
            y: swimlaneCenterY,
            width: frameWidth,
            height: SWIMLANE_H,
        });

        const storiesStartY = swimlaneBaseY + SWIMLANE_H;

        activities.forEach((activity, i) => {
            const colCenterX = tlX + PADDING + i * COL_W + CARD_W / 2;
            const releaseStories = activity.tasks.flatMap(t =>
                t.stories.filter(s => s.release === release)
            );

            releaseStories.forEach((story, k) => {
                const storyY = storiesStartY + k * (STORY_H + ROW_GAP) + STORY_H / 2;
                items.push({
                    kind: 'story',
                    title: story.title,
                    x: colCenterX,
                    y: storyY,
                    width: CARD_W,
                    height: STORY_H,
                    color: '#ffffff',
                });
            });
        });

        swimlaneBaseY = storiesStartY + maxStoriesPerRelease[r] * (STORY_H + ROW_GAP) + ROW_GAP;
    });

    return { frameWidth, frameHeight, items };
}
```

### Step 4: Run tests — verify they pass

```bash
cd cli && npm test -- --testPathPattern=miro-layout
```

Expected: PASS — 9 tests passing

### Step 5: Commit

```bash
cd cli && git add src/core/miro.ts tests/core/miro-layout.test.ts
git commit -m "feat: add miro layout engine"
```

---

## Task 3: miro.ts — REST Client

**Files:**
- Modify: `cli/src/core/miro.ts` (append REST client functions)

No new tests for this task — HTTP calls require live credentials. The integration test in Task 6 validates this end-to-end.

### Step 1: Append REST client to miro.ts

Add the following after the `computeLayout` export in `cli/src/core/miro.ts`:

```typescript
// ─── REST Client ─────────────────────────────────────────────────────────────

const MIRO_BASE = 'https://api.miro.com/v2';

interface MiroConfig {
    token: string;
    boardId: string;
}

async function miroRequest(config: MiroConfig, method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${MIRO_BASE}${path}`, {
        method,
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Miro API ${method} ${path} → ${response.status}: ${text}`);
    }

    if (response.status === 204) return null;
    return response.json();
}

async function createFrame(config: MiroConfig, title: string, width: number, height: number): Promise<string> {
    const data = await miroRequest(config, 'POST', `/boards/${encodeURIComponent(config.boardId)}/frames`, {
        data: { title, format: 'custom', type: 'freeform' },
        style: { fillColor: '#f5f5f5' },
        position: { x: 0, y: 0, origin: 'center', relativeTo: 'canvas_center' },
        geometry: { width, height },
    }) as { id: string };
    return data.id;
}

async function createCard(config: MiroConfig, frameId: string, item: LayoutItem): Promise<string> {
    const data = await miroRequest(config, 'POST', `/boards/${encodeURIComponent(config.boardId)}/cards`, {
        data: { title: item.title },
        style: { cardTheme: item.color },
        position: { x: item.x, y: item.y, origin: 'center', relativeTo: 'canvas_center' },
        geometry: { width: item.width, height: item.height },
        parent: { id: frameId },
    }) as { id: string };
    return data.id;
}

async function createText(config: MiroConfig, frameId: string, item: LayoutItem): Promise<string> {
    const data = await miroRequest(config, 'POST', `/boards/${encodeURIComponent(config.boardId)}/texts`, {
        data: { content: `<b>${item.title}</b>` },
        style: { fillColor: '#e8e8e8', textAlign: 'left', fontSize: '14' },
        position: { x: item.x, y: item.y, origin: 'center', relativeTo: 'canvas_center' },
        geometry: { width: item.width, height: item.height },
        parent: { id: frameId },
    }) as { id: string };
    return data.id;
}

async function updateCardTitle(config: MiroConfig, cardId: string, title: string): Promise<void> {
    await miroRequest(config, 'PATCH', `/boards/${encodeURIComponent(config.boardId)}/cards/${cardId}`, {
        data: { title },
    });
}

async function deleteItem(config: MiroConfig, itemId: string): Promise<void> {
    await miroRequest(config, 'DELETE', `/boards/${encodeURIComponent(config.boardId)}/items/${itemId}`);
}

async function listFrameCards(config: MiroConfig, frameId: string): Promise<{ id: string; title: string }[]> {
    const data = await miroRequest(
        config,
        'GET',
        `/boards/${encodeURIComponent(config.boardId)}/items?parent_item_id=${frameId}&type=card&limit=200`
    ) as { data: { id: string; data?: { title?: string } }[] };

    return (data.data || []).map(item => ({
        id: item.id,
        title: stripHtml(item.data?.title || ''),
    }));
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

    let frameId = existingFrameId;
    let created = 0;
    let updated = 0;
    let deleted = 0;

    if (!frameId) {
        // First sync: create frame + all items
        frameId = await createFrame(config, `Story Map — ${storyMap.project}`, frameWidth, frameHeight);

        for (const item of items) {
            if (item.kind === 'swimlane') {
                await createText(config, frameId, item);
            } else {
                await createCard(config, frameId, item);
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
            if (item.kind === 'swimlane') continue; // skip swimlane re-creation on update

            if (existingByTitle.has(item.title)) {
                await updateCardTitle(config, existingByTitle.get(item.title)!, item.title);
                updated++;
            } else {
                await createCard(config, frameId, item);
                created++;
            }
        }
    }

    return { frameId, created, updated, deleted };
}
```

### Step 2: Verify TypeScript compiles

```bash
cd cli && npm run build
```

Expected: No errors. `dist/` updated.

### Step 3: Commit

```bash
cd cli && git add src/core/miro.ts
git commit -m "feat: add miro REST client and sync orchestration"
```

---

## Task 4: `awm miro sync` Command

**Files:**
- Modify: `cli/src/index.ts`

### Step 1: Add imports and .env reader utility

At the top of `cli/src/index.ts`, after the existing imports, add:

```typescript
import fs from 'fs';
import { parseStoryMap, updateMiroFrameId } from './core/story-map-parser';
import { syncToMiro } from './core/miro';
```

Then add this helper function **before** `program.parse()`:

```typescript
function loadEnvFile(cwd: string): Record<string, string> {
    const envPath = path.join(cwd, '.env');
    if (!fs.existsSync(envPath)) return {};
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key) env[key] = value;
    }
    return env;
}
```

### Step 2: Add the miro command

Add this block **before** `program.parse()`:

```typescript
const miroCmd = program.command('miro').description('Miro board integration');

miroCmd.command('sync <storyMapPath>')
    .description('Sync a story-map.md file to a Miro board frame')
    .action(async (storyMapPath: string) => {
        intro(pc.bgCyan(pc.black(' AWM - Miro Sync ')));

        // 1. Load config from .env in cwd
        const env = loadEnvFile(process.cwd());
        const token = env['MIRO_TOKEN'];
        const boardId = env['MIRO_BOARD_ID'];

        if (!token || !boardId) {
            console.error(pc.red('✗ Missing config. Add to .env in project root:'));
            console.error(pc.dim('  MIRO_TOKEN=your_token_here'));
            console.error(pc.dim('  MIRO_BOARD_ID=your_board_id_here'));
            process.exit(1);
        }

        // 2. Read and parse story map
        const resolvedPath = path.resolve(process.cwd(), storyMapPath);
        if (!fs.existsSync(resolvedPath)) {
            console.error(pc.red(`✗ File not found: ${resolvedPath}`));
            process.exit(1);
        }

        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const storyMap = parseStoryMap(content);

        if (storyMap.activities.length === 0) {
            console.error(pc.red('✗ No activities found in Backbone section. Check markdown format.'));
            process.exit(1);
        }

        // 3. Sync to Miro
        const s = spinner();
        const isFirstSync = !storyMap.miro_frame_id;
        s.start(isFirstSync ? 'Creating Miro frame...' : 'Updating Miro frame...');

        try {
            const result = await syncToMiro(
                { token, boardId },
                storyMap,
                storyMap.miro_frame_id
            );

            // 4. Persist frame ID back to frontmatter on first sync
            if (isFirstSync) {
                const updated = updateMiroFrameId(content, result.frameId);
                fs.writeFileSync(resolvedPath, updated, 'utf-8');
            }

            s.stop('Sync complete!');
            console.log(pc.green(`  ✓ Frame: ${result.frameId}`));
            console.log(pc.green(`  ✓ Created: ${result.created} | Updated: ${result.updated} | Deleted: ${result.deleted}`));
            outro(`Story map synced to Miro. Open your board to view the frame.`);
        } catch (e: any) {
            s.stop('Sync failed.');
            console.error(pc.red(`✗ ${e.message}`));
            process.exit(1);
        }
    });
```

### Step 3: Build and verify no TypeScript errors

```bash
cd cli && npm run build
```

Expected: Compiles successfully. No type errors.

### Step 4: Verify command appears in help

```bash
node cli/dist/index.js miro --help
```

Expected output:
```
Usage: awm miro [options] [command]

Miro board integration

Commands:
  sync <storyMapPath>  Sync a story-map.md file to a Miro board frame
```

### Step 5: Commit

```bash
cd cli && git add src/index.ts
git commit -m "feat: add awm miro sync command"
```

---

## Task 5: Update SKILL.md TERMINATION_PHASE

**Files:**
- Modify: `registry/skills/story-mapping/SKILL.md`

### Step 1: Locate the TERMINATION_PHASE section

The section starts at line 421 of `registry/skills/story-mapping/SKILL.md`:

```markdown
## <TERMINATION_PHASE>

Cuando el modo de operación concluya (documento generado, sesión cerrada, o actualización guardada), **DETENTE**.

Tu único paso final es:
1. Confirmar al usuario la ruta del documento actualizado y un resumen de cambios
2. Preguntar: *"¿Necesitas algo más del Story Map? Puedo acompañarte en otra sesión, actualizar con más historias, o si quieres continuar con otro paso de documentación, invoca `docs-system-orchestrator`."*
3. Esperar confirmación. No proceder automáticamente.
```

### Step 2: Replace the TERMINATION_PHASE section

Replace the entire `## <TERMINATION_PHASE>` section with:

```markdown
## <TERMINATION_PHASE>

Cuando el modo de operación concluya (documento generado, sesión cerrada, o actualización guardada), **DETENTE**.

Tu único paso final es:
1. Confirmar al usuario la ruta del documento actualizado y un resumen de cambios
2. Si el proyecto tiene `MIRO_TOKEN` y `MIRO_BOARD_ID` en su `.env`, mencionar:
   > "Para sincronizar con Miro: `awm miro sync docs/50-projects/story-map.md`"
3. Preguntar: *"¿Necesitas algo más del Story Map? Puedo acompañarte en otra sesión, actualizar con más historias, o si quieres continuar con otro paso de documentación, invoca `docs-system-orchestrator`."*
4. Esperar confirmación. No proceder automáticamente.
```

### Step 3: Run all tests to confirm nothing broke

```bash
cd cli && npm test
```

Expected: All existing tests pass.

### Step 4: Commit

```bash
git add registry/skills/story-mapping/SKILL.md
git commit -m "feat: mention awm miro sync in story-mapping termination phase"
```

---

## Task 6: Build & Integration Test

**Files:** None new — this task validates the full flow end-to-end.

### Step 1: Run full test suite

```bash
cd cli && npm test
```

Expected: All tests pass (story-map-parser + miro-layout + existing tests).

### Step 2: Build final artifact

```bash
cd cli && npm run build
```

Expected: No errors.

### Step 3: Create a test story map for integration test

In a temp directory or your docs repo, create `test-story-map.md`:

```markdown
---
project: Test Integration
---

# Story Map — Test Integration

## Goal
> Validar que el comando awm miro sync funciona correctamente

## Backbone

### 🟡 Actividad de prueba

#### 🔵 Task: Tarea de prueba
- **[MVP]** Como usuario, quiero validar la integración con Miro

## Changelog

- [2026-03-31] Sesión de prueba
```

And create `.env` in the same directory:

```
MIRO_TOKEN=your_token_here
MIRO_BOARD_ID=your_board_id_here
```

### Step 4: Run the sync command from that directory

```bash
cd /path/to/test/dir
node /path/to/agentic-workflow/cli/dist/index.js miro sync test-story-map.md
```

Expected output:
```
◆ AWM - Miro Sync
✓ Sync complete!
  ✓ Frame: 3458764XXXXXXXXX
  ✓ Created: 3 | Updated: 0 | Deleted: 0
◆ Story map synced to Miro. Open your board to view the frame.
```

Verify in Miro that the frame appears on the board with Activity (yellow), Task (blue), and Story (white) cards.

### Step 5: Verify frontmatter updated

```bash
head -5 test-story-map.md
```

Expected — `miro_frame_id` now present:
```
---
project: Test Integration
miro_frame_id: "3458764XXXXXXXXX"
---
```

### Step 6: Run sync again (update flow)

```bash
node /path/to/cli/dist/index.js miro sync test-story-map.md
```

Expected: `Updated: 3 | Created: 0 | Deleted: 0`

### Step 7: Final commit

```bash
git add -A
git commit -m "test: validate miro integration end-to-end"
```
