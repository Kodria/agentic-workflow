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
