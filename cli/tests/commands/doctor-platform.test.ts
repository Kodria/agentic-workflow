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

  it('labels native Windows as supported and CI-verified, not deferred to WSL', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const out = renderReport(emptyReport());
    expect(out).toContain('platform: Windows (native, CI-verified)');
    expect(out).not.toContain('WSL');
  });

  it('surfaces the narrow awm-watch supervisor caveat on native Windows only', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const winOut = renderReport(emptyReport());
    expect(winOut).toMatch(/awm watch/i);

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const linuxOut = renderReport(emptyReport());
    expect(linuxOut).not.toMatch(/awm watch/i);
  });
});
