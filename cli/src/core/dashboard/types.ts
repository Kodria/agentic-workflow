export type DashboardItemState = 'ok' | 'attention' | 'missing' | 'unavailable' | 'not_applicable';

export interface DashboardItemV1 {
    id: string;
    label: string;
    state: DashboardItemState;
    detail?: string;
    remediation?: string;
}

export interface DashboardSectionV1 {
    id: 'machine' | 'project' | 'planning' | 'execution' | 'qa' | 'retro' | 'history';
    availability: 'available' | 'unavailable' | 'not_applicable';
    items: DashboardItemV1[];
}

export interface DashboardSnapshotV1 {
    schema: 1;
    generatedAt: string;
    overall: 'healthy' | 'degraded';
    project: { detected: boolean; label: string };
    confidence: 'none' | 'provisional' | 'observing' | 'supported';
    sections: DashboardSectionV1[];
}

const PROJECT_SECTION_IDS: DashboardSectionV1['id'][] = ['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history'];

/** Safe, deterministic V1 fixture and renderer input. */
export function dashboardSnapshot(
    overrides: Partial<DashboardSnapshotV1> = {},
): DashboardSnapshotV1 {
    const { project: projectOverride, sections: sectionsOverride, ...rest } = overrides;
    const project = projectOverride ?? { detected: false, label: 'No project detected' };
    const sections = sectionsOverride ?? (project.detected
        ? PROJECT_SECTION_IDS.map((id) => ({ id, availability: id === 'machine' ? 'available' as const : 'not_applicable' as const, items: [] }))
        : [{ id: 'machine' as const, availability: 'available' as const, items: [] }]);
    return {
        schema: 1,
        generatedAt: '2026-08-22T00:00:00.000Z',
        overall: 'healthy',
        project,
        confidence: 'none',
        sections,
        ...rest,
    };
}
