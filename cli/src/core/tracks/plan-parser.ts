import path from 'path';

export interface ParsedTrack {
    trackId: string;
    taskIds: string[];
    ownership: string[];
    dependsOn: string[];
    sharedResources: string[];
}
export type ParsedTrackPlan =
    | { mode: 'serial'; reason: string }
    | { mode: 'parallel-candidate'; tracks: Record<string, ParsedTrack>; integration: { argv: string[]; paths: string[] } };

const taskHeading = /^### Task ([^:]+):/;
const trackLine = /^\*\*Track:\*\*\s*(.*)$/;
const fileLine = /^- (?:Create|Modify|Test|Delete):\s+`([^`]+)`/;
const EXACT_MATCH_ERROR = 'membresía y filas de ## Tracks requieren coincidencia exacta';

function jsonStrings(label: string, raw: string | undefined): string[] {
    if (raw === undefined) throw new Error(`${label} es obligatorio para paralelismo`);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error(`${label} debe ser JSON string[]`); }
    if (!Array.isArray(value) || value.length === 0 || value.some((x) => typeof x !== 'string' || x.length === 0)) {
        throw new Error(`${label} debe ser JSON string[] no vacío`);
    }
    return value;
}

function canonicalFile(raw: string): string {
    const withoutLines = raw.replace(/:\d+(?:-\d+)?$/, '');
    const posix = withoutLines.replaceAll('\\', '/');
    const normalized = path.posix.normalize(posix);
    if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
        throw new Error(`Files path fuera del repo: ${raw}`);
    }
    return normalized.replace(/^\.\//, '');
}

export function parseTrackPlan(source: string, checkRef: (id: string) => boolean): ParsedTrackPlan {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const hasMembership = lines.some((line) => trackLine.test(line));
    const tracksHeading = lines.findIndex((line) => line.trim() === '## Tracks');
    if (!hasMembership && tracksHeading < 0) return { mode: 'serial', reason: 'no-tracks' };
    if (!hasMembership || tracksHeading < 0) throw new Error('Track membership y ## Tracks deben coexistir');

    const argvRaw = lines.find((l) => l.startsWith('**Integration argv:**'))?.slice('**Integration argv:**'.length).trim();
    const pathsRaw = lines.find((l) => l.startsWith('**Integration paths:**'))?.slice('**Integration paths:**'.length).trim();
    const integration = { argv: jsonStrings('Integration argv', argvRaw), paths: jsonStrings('Integration paths', pathsRaw) };
    const declared = new Map<string, ParsedTrack>();
    for (const line of lines.slice(tracksHeading + 1)) {
        if (line.startsWith('## ')) break;
        const cells = line.split('|').slice(1, -1).map((x) => x.trim());
        if (cells.length !== 3 || cells[0] === 'Track' || /^[-:]+$/.test(cells[0])) continue;
        const [id, dependsRaw, resourcesRaw] = cells;
        if (!id || id === '.' || id === '..' || id.startsWith('-') || id.includes('/') || id.includes('\\') || !checkRef(id)) {
            throw new Error(`track id inválido: ${JSON.stringify(id)}`);
        }
        if (declared.has(id)) throw new Error(`track duplicado: ${id}`);
        const resources = resourcesRaw === '[]' ? [] : resourcesRaw.length === 0 ? null : resourcesRaw.split(',').map((x) => x.trim());
        const dependsOn = dependsRaw === 'none' ? [] : dependsRaw.split(',').map((x) => x.trim());
        declared.set(id, { trackId: id, taskIds: [], ownership: [], dependsOn, sharedResources: resources ?? [] });
        if (resources === null) return { mode: 'serial', reason: `shared-resources-missing:${id}` };
    }
    let taskId: string | null = null;
    let member: string | null = null;
    let pendingFiles: string[] = [];
    for (const line of lines) {
        const heading = line.match(taskHeading);
        if (heading !== null) {
            if (taskId !== null && pendingFiles.length > 0 && member === null) throw new Error(`task ${taskId} tiene Files pero no Track`);
            taskId = heading[1].trim(); member = null; pendingFiles = []; continue;
        }
        const membership = line.match(trackLine);
        if (membership !== null) {
            if (taskId === null || member !== null) throw new Error('cada task admite exactamente un Track');
            member = membership[1].trim();
            const track = declared.get(member);
            if (track === undefined) throw new Error(EXACT_MATCH_ERROR);
            track.taskIds.push(taskId);
            track.ownership.push(...pendingFiles);
        }
        const file = line.match(fileLine);
        if (file !== null) {
            const canonical = canonicalFile(file[1]);
            if (member === null) pendingFiles.push(canonical);
            else declared.get(member)!.ownership.push(canonical);
        }
    }
    // La última task del documento no tiene un `### Task` siguiente que dispare el chequeo del loop.
    if (taskId !== null && pendingFiles.length > 0 && member === null) throw new Error(`task ${taskId} tiene Files pero no Track`);
    const members = new Set([...declared.values()].flatMap((t) => t.taskIds.length > 0 ? [t.trackId] : []));
    if (members.size !== declared.size) throw new Error(EXACT_MATCH_ERROR);
    if ([...declared.values()].some((t) => t.dependsOn.length > 0)) return { mode: 'serial', reason: 'track-dependency' };
    return { mode: 'parallel-candidate', tracks: Object.fromEntries(declared), integration };
}
