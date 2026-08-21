import type { RunOutput, SensorResult } from './types';

/** Reduce all selected sensor outcomes through one format-agnostic verdict rule. */
export function reduceVerdict(results: SensorResult[]): RunOutput['overall'] {
    if (!Array.isArray(results)) throw new Error('sensor results must be an array');
    for (const result of results) {
        if (!result || typeof result !== 'object') throw new Error('sensor result must be an object');
        if (!['pass', 'fail', 'inconclusive', 'skipped'].includes(result.status)) {
            throw new Error('sensor result status is invalid');
        }
    }
    if (results.some(result => result.status === 'fail')) return 'fail';
    if (results.some(result => result.status === 'inconclusive')) return 'not_certified';
    if (results.some(result => result.status === 'pass')) return 'pass';
    return 'skipped';
}
