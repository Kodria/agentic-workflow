import { emit, type CommandResult } from '../command-result';
import type { Failure } from './range';
import { clipMessage, cleanText } from './text-safety';

// What the Change Record commands (`change new`, `change validate`, `changes list`) share of their command line: one line of
// output, the stderr form of a failure and the working-directory guard of an action. Nothing here throws or imports a command.

/** One line of output: control characters escaped, at most 300 UTF-16 units (an ellipsis replaces the cut), never splitting a surrogate pair. */
export const line = (text: string): string => clipMessage(cleanText(text));

/**
 * Exit 2 with `code: message` as ONE clipped line (the code counts), and an optional static remedy as a second clipped line.
 * Untrusted text is escaped by the caller with esc().
 */
export const fail = (code: string, message: string, remedy?: string): CommandResult => ({
    code: 2, stdout: '',
    stderr: `${line(`${code}: ${message}`)}\n${remedy ? `${line(`  remedy: ${remedy}`)}\n` : ''}`,
});

/** A shared-helper Failure as the stderr form. */
export const failed = (f: Failure): CommandResult => fail(f.code, f.message, f.remedy);

/**
 * The action wrapper: runs `command` in the working directory and emits its result. The working directory may be gone: then
 * `noCwd()` is emitted instead. Nothing may throw out of the action.
 */
export function inCwd(command: (cwd: string) => CommandResult, noCwd: () => CommandResult): void {
    let cwd: string;
    try { cwd = process.cwd(); } catch { emit(noCwd()); return; }
    emit(command(cwd));
}
