import type { RunOutput, SensorResult } from './types';

/** Reduce all selected sensor outcomes through one format-agnostic verdict rule. */
export function reduceVerdict(results: SensorResult[]): RunOutput['overall'] {
    if (results.some(result => result.status === 'fail')) return 'fail';
    if (results.some(result => result.status === 'inconclusive')) return 'not_certified';
    if (results.some(result => result.status === 'pass')) return 'pass';
    return 'skipped';
}
