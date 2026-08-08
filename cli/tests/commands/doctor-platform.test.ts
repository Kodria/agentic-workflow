import { renderReport, renderProviderReport } from '../../src/commands/doctor';
import { CheckReport, ProviderDiagnosticReport } from '../../src/core/diagnostics/types';

describe('doctor renderReport — platform line', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  function emptyReport(): CheckReport {
    return { overall: 'healthy', hasProject: false, projectName: undefined, results: [] } as CheckReport;
  }

  it('renders the platform label under the Machine header', () => {
    setPlatform('linux');
    const out = renderReport(emptyReport());
    expect(out).toContain('platform: Linux');
  });

  it('labels native Windows as supported and CI-verified, not deferred to WSL', () => {
    setPlatform('win32');
    const out = renderReport(emptyReport());
    expect(out).toContain('platform: Windows (native, CI-verified)');
    expect(out).not.toContain('WSL');
  });

  // `renderReport` (init's before/after dashboard) deliberately does NOT
  // embed the Windows caveat — it used to (R7), which made a single `awm
  // init` run print the same caveat text 3 times (once via `noteWindowsCaveat`
  // at the top of `runInit`, once for "Initial state", once for "Final
  // state"). The caveat now lives solely in `runInit`'s own single emission
  // and in `renderProviderReport` below (the real `awm doctor` output).
  it('never embeds the awm-watch supervisor caveat in the init before/after dashboard', () => {
    setPlatform('win32');
    const out = renderReport(emptyReport());
    expect(out).not.toMatch(/awm watch/i);
  });
});

// Regression coverage for the confirmed bug: the `WINDOWS_KNOWN_GAP` caveat
// used to live only inside `renderReport`, whose only callers are `init.ts`'s
// before/after dashboard — `awm doctor`'s REAL command path
// (`runDoctor` → `renderProviderReport`) never touched it, so a user running
// `awm doctor` on native Windows never saw the caveat its own code comment
// claimed doctor was the place for. This exercises `renderProviderReport`
// directly, the function `runDoctor` actually calls for its text output.
describe('doctor renderProviderReport — platform caveat (the real `awm doctor` path)', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  function emptyProviderReport(): ProviderDiagnosticReport {
    return { overall: 'healthy', providers: [] };
  }

  it('surfaces the narrow awm-watch supervisor caveat on native Windows only, not on macOS or Linux', () => {
    setPlatform('win32');
    const winOut = renderProviderReport(emptyProviderReport());
    expect(winOut).toMatch(/awm watch/i);

    for (const p of ['linux', 'darwin'] as const) {
      setPlatform(p);
      const out = renderProviderReport(emptyProviderReport());
      expect(out).not.toMatch(/awm watch/i);
    }
  });
});
