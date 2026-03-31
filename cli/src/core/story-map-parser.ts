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
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: content };

    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        // Empty value is intentionally skipped — keys without values are not meaningful metadata
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
    // Normalize CRLF to LF so all downstream regexes can assume Unix line endings
    const normalized = content.replace(/\r\n/g, '\n');
    const { meta, body } = parseFrontmatter(normalized);

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
    const match = content.match(/^(---\n)([\s\S]*?)(\n---\n?)([\s\S]*)$/);
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
