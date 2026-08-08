// jest.setup.js
//
// Forces deterministic, colorless output for every test run, regardless of the
// runner's own TTY/CI detection. picocolors (src/**'s color library) treats being
// on win32 OR having a `CI` env var set as automatic color support:
//
//   isColorSupported = !NO_COLOR && (FORCE_COLOR || win32 || (isTTY && TERM!=='dumb') || CI)
//
// GitHub Actions sets `CI=true` on every runner (any OS), and additionally
// unconditionally colors on win32 regardless of CI at all — so a test asserting an
// exact/substring match against CLI output (e.g. `toContain('✔ CLI v1.0.0')`) that
// passes locally (no CI env, non-TTY -> colorless) silently breaks on real CI, where
// the same string arrives wrapped in ANSI escapes. NO_COLOR overrides every other
// signal picocolors checks, so setting it here — before any test file (and its
// transitive `picocolors` require) loads — makes color support deterministically off
// everywhere this suite runs. Confirmed via R6's first real CI run (2026-08-08).
process.env.NO_COLOR = '1';
