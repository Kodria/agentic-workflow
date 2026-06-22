import { renderReport } from '../../src/commands/doctor';
import { CheckReport } from '../../src/core/diagnostics/types';

describe('doctor renderReport — platform line', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  function emptyReport(): CheckReport {
    return { overall: 'healthy', hasProject: false, projectName: undefined, results: [] } as CheckReport;
  }

  it('renders the platform label under the Machine header', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const out = renderReport(emptyReport());
    expect(out).toContain('platform: Linux');
  });

  it('flags native Windows with a WSL hint', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const out = renderReport(emptyReport());
    expect(out).toContain('WSL');
  });
});
