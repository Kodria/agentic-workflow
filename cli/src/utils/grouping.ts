import { ArtifactType } from '../providers';
import { ProcessDefinition } from '../core/discovery';

export interface GroupableArtifact {
    name: string;
    type: ArtifactType;
    [k: string]: any;
}

export interface CombinedArtifact {
    baseName: string;
    artifacts: GroupableArtifact[];
}

export function buildGroupedOptions<T extends GroupableArtifact>(
    artifacts: T[],
    processes: ProcessDefinition[],
    formatLabel: (c: CombinedArtifact) => string
): { value: any; label: string; hint?: string }[] {
    const grouped = new Map<string, Map<string, T[]>>();
    const standalone = new Map<string, T[]>();

    for (const a of artifacts) {
        let foundParent = false;
        const baseName = (a.type === 'workflow' || a.type === 'agent') ? a.name.replace(/\.md$/, '') : a.name;

        for (const p of processes) {
            if ((a.type === 'skill' && p.skills.includes(baseName)) ||
                (a.type === 'workflow' && p.workflows.includes(baseName)) ||
                (a.type === 'agent' && p.agents?.includes(baseName))) {
                if (!grouped.has(p.name)) grouped.set(p.name, new Map());
                const procGroup = grouped.get(p.name)!;
                if (!procGroup.has(baseName)) procGroup.set(baseName, []);
                procGroup.get(baseName)!.push(a);
                foundParent = true;
            }
        }
        if (!foundParent) {
            if (!standalone.has(baseName)) standalone.set(baseName, []);
            standalone.get(baseName)!.push(a);
        }
    }

    const options: { value: any; label: string; hint?: string }[] = [];

    for (const [procName, baseNameMap] of grouped.entries()) {
        const proc = processes.find(p => p.name === procName)!;
        const children = Array.from(baseNameMap.entries()).map(([baseName, arr]) => ({ baseName, artifacts: arr }));
        options.push({
            value: { _group: true, processName: procName, children },
            label: `📦 ${procName}`,
            hint: `${proc.description} — ${children.length} artifacts`
        });
        children.forEach((c, idx) => {
            const prefix = idx === children.length - 1 ? '  └─ ' : '  ├─ ';
            options.push({ value: { _child: true, combined: c }, label: `${prefix}${formatLabel(c)}` });
        });
    }

    if (standalone.size > 0) {
        Array.from(standalone.entries()).forEach(([baseName, arr]) => {
            const c = { baseName, artifacts: arr };
            options.push({ value: { _child: true, combined: c }, label: `🔹 ${formatLabel(c)}` });
        });
    }

    return options;
}
