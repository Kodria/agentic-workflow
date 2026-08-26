export type RequirementId = string;
export type EntityId = string;
export type ReviewEvidence = 'specification' | 'code-quality';
export type SliceRisk = 'bounded' | 'full-context';

export interface PlanDiagnostic { code: string; message: string; field?: string; }
export interface PlanSource { id: EntityId; path: string; locator: string; fact: string; }
export interface PlanCommand { id: EntityId; program: string; args: string[]; covers: RequirementId[]; }
export interface PlanSlice {
    id: EntityId; title: string; requirements: RequirementId[]; dependsOn: EntityId[]; sectionAnchor: string;
    sources: EntityId[]; redCommands: EntityId[]; greenCommands: EntityId[];
    reviewEvidence: ReviewEvidence[]; risk: SliceRisk; fallback: string[];
}
export interface CompactPlanManifest {
    schema: 'compact-slices/v1'; planId: string; requirements: RequirementId[]; sources: PlanSource[];
    commands: PlanCommand[]; slices: PlanSlice[]; closureCommands: EntityId[];
}
export type PlanValidationReport =
    | { state: 'valid'; schema: 'compact-slices/v1'; manifest: CompactPlanManifest }
    | { state: 'legacy' }
    | { state: 'invalid'; diagnostics: PlanDiagnostic[] }
    | { state: 'unsupported'; schema: string; diagnostics: PlanDiagnostic[] };
