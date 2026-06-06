jest.mock('@clack/prompts', () => ({ log: { success: jest.fn(), info: jest.fn() } }));
jest.mock('picocolors', () => ({ green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s }));
jest.mock('../../../src/commands/sensors/run', () => ({ runSensors: jest.fn() }));
jest.mock('../../../src/commands/sensors/init', () => ({ initSensors: jest.fn() }));
jest.mock('../../../src/commands/sensors/status', () => ({ computeSensorStatus: jest.fn() }));
jest.mock('../../../src/commands/sensors/install', () => ({ installSensorHook: jest.fn() }));
jest.mock('../../../src/commands/sensors/baseline', () => ({ buildBaseline: jest.fn(), writeBaseline: jest.fn() }));
jest.mock('../../../src/core/bundles', () => ({ REGISTRY_CONTENT_DIR: '/mock/registry' }));

import { exitCodeFor, RunOutputLike } from '../../../src/commands/sensors/index';

describe('exitCodeFor — sensor run verdict → exit code', () => {
    const base = (overall: RunOutputLike['overall']): RunOutputLike => ({ sensors: [], overall });
    it('pass → 0', () => expect(exitCodeFor(base('pass'))).toBe(0));
    it('skipped → 0', () => expect(exitCodeFor(base('skipped'))).toBe(0));
    it('not_certified → 0 (signal is in overall, not exit code)', () =>
        expect(exitCodeFor(base('not_certified'))).toBe(0));
    it('fail → 1', () => expect(exitCodeFor(base('fail'))).toBe(1));
});
