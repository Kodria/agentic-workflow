import { SensorError } from '../types';

/**
 * Tests are an exit-code sensor: the runner's exit status IS the signal, not the
 * parsed output. A passing run prints output ("6 passed") that must NOT be treated
 * as findings — so the success path yields no errors. The failure path (non-zero
 * exit) is handled in runSensor via isExitCodeSensor, not here.
 */
export function parseTestOutput(_raw: string): SensorError[] {
    return [];
}
