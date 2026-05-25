import { SensorError } from '../types';

export function parseGenericOutput(raw: string): SensorError[] {
    if (!raw.trim()) return [];
    return [{ message: `SENSOR[raw] ${raw.trim()}` }];
}
