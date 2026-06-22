/** True only when both ends are TTYs — the precondition for the interactive picker. */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/** Current terminal size, with a safe 80x24 fallback when undefined (non-TTY). */
export function terminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}
