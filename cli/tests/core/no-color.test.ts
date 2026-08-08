// tests/core/no-color.test.ts
//
// Regression for R6 (2026-08-08): picocolors treats being on win32 OR having a `CI`
// env var set as automatic color support, REGARDLESS of TTY status — GitHub Actions
// sets `CI=true` on every runner (any OS) and this suite's own tests assert exact/
// substring CLI text output that silently breaks once ANSI escapes are interleaved
// into it. jest.setup.js forces `NO_COLOR=1` before any test file loads specifically
// to make this deterministic everywhere this suite runs, not just where it happens
// to be colorless by accident (no real TTY, no CI env). This test pins that: if
// jest.setup.js's NO_COLOR line were ever removed or the wiring in jest.config.js
// broke, this is the one test that fails on ITS OWN merits, not as a side effect of
// some other test's substring assertion breaking.
import pc from 'picocolors';

test('picocolors never emits ANSI escapes during this test run', () => {
    expect(pc.isColorSupported).toBe(false);
    expect(pc.red('x')).toBe('x');
    expect(pc.green('x')).toBe('x');
});
