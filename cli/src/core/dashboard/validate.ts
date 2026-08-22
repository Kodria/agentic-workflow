import type { DashboardItemState, DashboardSnapshotV1 } from './types';

const SECTION_ORDER = ['machine', 'project', 'planning', 'execution', 'qa', 'retro', 'history'] as const;
const ITEM_STATES = ['ok', 'attention', 'missing', 'unavailable', 'not_applicable'] as const;
const AVAILABILITIES = ['available', 'unavailable', 'not_applicable'] as const;
const OVERALLS = ['healthy', 'degraded'] as const;
const CONFIDENCES = ['none', 'provisional', 'observing', 'supported'] as const;
const ACTIONABLE_STATES = new Set<DashboardItemState>(['attention', 'missing', 'unavailable']);

export class DashboardValidationError extends Error {
    constructor(message: string) {
        super(`Invalid DashboardSnapshotV1: ${message}`);
        this.name = 'DashboardValidationError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
    if (!isRecord(value)) throw new DashboardValidationError(`${path} must be an object`);
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) throw new DashboardValidationError(`${path}.${key} is not supported`);
    }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new DashboardValidationError(`${path} must be a non-empty string`);
    }
}

function assertEnum<T extends string>(value: unknown, values: readonly T[], path: string): asserts value is T {
    if (typeof value !== 'string' || !values.includes(value as T)) {
        throw new DashboardValidationError(`${path} must be one of ${values.join(', ')}`);
    }
}

/** Validates the durable public dashboard boundary without coercing unknown input. */
export function validateDashboardSnapshotV1(value: unknown): DashboardSnapshotV1 {
    assertRecord(value, 'snapshot');
    assertOnlyKeys(value, ['schema', 'generatedAt', 'overall', 'project', 'confidence', 'sections'], 'snapshot');
    if (value.schema !== 1) throw new DashboardValidationError('schema must be version 1');
    assertNonEmptyString(value.generatedAt, 'generatedAt');
    if (Number.isNaN(Date.parse(value.generatedAt))) throw new DashboardValidationError('generatedAt must be a valid date-time');
    assertEnum(value.overall, OVERALLS, 'overall');
    assertEnum(value.confidence, CONFIDENCES, 'confidence');

    assertRecord(value.project, 'project');
    assertOnlyKeys(value.project, ['detected', 'label'], 'project');
    if (typeof value.project.detected !== 'boolean') throw new DashboardValidationError('project.detected must be boolean');
    assertNonEmptyString(value.project.label, 'project.label');

    if (!Array.isArray(value.sections)) throw new DashboardValidationError('sections must be an array');
    const sectionIds = new Set<string>();
    const itemIds = new Set<string>();
    let previousOrder = -1;
    for (const [sectionIndex, section] of value.sections.entries()) {
        const sectionPath = `sections[${sectionIndex}]`;
        assertRecord(section, sectionPath);
        assertOnlyKeys(section, ['id', 'availability', 'items'], sectionPath);
        assertEnum(section.id, SECTION_ORDER, `${sectionPath}.id`);
        const order = SECTION_ORDER.indexOf(section.id);
        if (order <= previousOrder) throw new DashboardValidationError('section order must be deterministic');
        previousOrder = order;
        if (sectionIds.has(section.id)) throw new DashboardValidationError(`duplicate section id ${section.id}`);
        sectionIds.add(section.id);
        assertEnum(section.availability, AVAILABILITIES, `${sectionPath}.availability`);
        if (!Array.isArray(section.items)) throw new DashboardValidationError(`${sectionPath}.items must be an array`);

        for (const [itemIndex, item] of section.items.entries()) {
            const itemPath = `${sectionPath}.items[${itemIndex}]`;
            assertRecord(item, itemPath);
            assertOnlyKeys(item, ['id', 'label', 'state', 'detail', 'remediation'], itemPath);
            assertNonEmptyString(item.id, `${itemPath}.id`);
            if (itemIds.has(item.id)) throw new DashboardValidationError(`duplicate item id ${item.id}`);
            itemIds.add(item.id);
            assertNonEmptyString(item.label, `${itemPath}.label`);
            assertEnum(item.state, ITEM_STATES, `${itemPath}.state`);
            if (item.detail !== undefined) assertNonEmptyString(item.detail, `${itemPath}.detail`);
            if (item.remediation !== undefined) assertNonEmptyString(item.remediation, `${itemPath}.remediation`);
            if (ACTIONABLE_STATES.has(item.state) && item.remediation === undefined) {
                throw new DashboardValidationError(`${itemPath}.remediation is required for actionable state`);
            }
            if (item.state === 'not_applicable' && item.remediation !== undefined) {
                throw new DashboardValidationError(`${itemPath}.remediation is forbidden for not_applicable state`);
            }
        }
    }

    return value as unknown as DashboardSnapshotV1;
}
