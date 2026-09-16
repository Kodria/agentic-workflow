// CLI command tests deliberately exercise non-zero exit codes. Jest runs all
// tests in a worker process, so a test must never leak that process-wide state
// into a later test or the runner's own final exit status.
afterEach(() => {
  process.exitCode = undefined;
});
