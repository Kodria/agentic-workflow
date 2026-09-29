import { Command } from 'commander';
import { DURABLE_CUSTODY_SUSPENDED_MESSAGE, isDurableCustodySuspended } from '../../../src/core/journal/durable-custody';
import { registerWatchCommand } from '../../../src/commands/watch';

describe('durable custody suspension', () => {
    const original = process.env.AWM_ALLOW_DURABLE_CUSTODY;

    afterEach(() => {
        if (original === undefined) delete process.env.AWM_ALLOW_DURABLE_CUSTODY;
        else process.env.AWM_ALLOW_DURABLE_CUSTODY = original;
    });

    it('is suspended for operators (env unset) and only re-enabled by the Jest harness', () => {
        delete process.env.AWM_ALLOW_DURABLE_CUSTODY;
        expect(isDurableCustodySuspended()).toBe(true);
        process.env.AWM_ALLOW_DURABLE_CUSTODY = '0';
        expect(isDurableCustodySuspended()).toBe(true);
        process.env.AWM_ALLOW_DURABLE_CUSTODY = '1';
        expect(isDurableCustodySuspended()).toBe(false);
    });

    it('refuses every awm watch entry point while suspended', async () => {
        delete process.env.AWM_ALLOW_DURABLE_CUSTODY;
        const program = new Command();
        registerWatchCommand(program);
        const err: string[] = [];
        const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw Object.assign(new Error(`exit:${code ?? 0}`), { code });
        }) as never);
        program.configureOutput({ writeErr: (s) => { err.push(String(s)); } });
        // stderr write in the refusal helper bypasses configureOutput; capture it too.
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
            err.push(String(chunk));
            return true;
        }) as typeof process.stderr.write);

        await expect(program.parseAsync(['node', 'awm', 'watch', 'journal-status'])).rejects.toThrow(/exit:1/);
        expect(err.join('')).toContain(DURABLE_CUSTODY_SUSPENDED_MESSAGE);

        err.length = 0;
        await expect(program.parseAsync(['node', 'awm', 'watch', '--init', '--plan', 'docs/plan.md'])).rejects.toThrow(/exit:1/);
        expect(err.join('')).toContain(DURABLE_CUSTODY_SUSPENDED_MESSAGE);

        exit.mockRestore();
        stderr.mockRestore();
    });
});
