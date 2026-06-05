// cli/tests/core/context/strategies/hook-merge.test.ts
import { HookMergeStrategy } from '../../../../src/core/context/strategies/hook-merge';
import * as install from '../../../../src/commands/hooks/install';
import * as uninstall from '../../../../src/commands/hooks/uninstall';
import * as status from '../../../../src/commands/hooks/status';
import { ProviderConfig } from '../../../../src/providers';
import { InjectionInput } from '../../../../src/core/context/types';

function input(): InjectionInput {
    return {
        ref: { absPath: '/tmp/awm-context.md', scope: 'global', contentHash: 'h' },
        registryRoot: '/reg', installMethod: 'symlink', agent: 'claude-code', scope: 'global',
    };
}
const provider = {} as ProviderConfig;
const strat = new HookMergeStrategy();

describe('HookMergeStrategy', () => {
    it('inject delegates to installHook with agent/registryRoot/installMethod', () => {
        const spy = jest.spyOn(install, 'installHook').mockReturnValue({} as any);
        strat.inject(input(), provider);
        expect(spy).toHaveBeenCalledWith({ agent: 'claude-code', registryRoot: '/reg', installMethod: 'symlink' });
        spy.mockRestore();
    });

    it('remove delegates to uninstallHook', () => {
        const spy = jest.spyOn(uninstall, 'uninstallHook').mockReturnValue({} as any);
        strat.remove(input(), provider);
        expect(spy).toHaveBeenCalledWith({ agent: 'claude-code' });
        spy.mockRestore();
    });

    it.each([
        ['HEALTHY', 'injected'],
        ['DEGRADED', 'stale'],
        ['NOT_INSTALLED', 'absent'],
    ])('status maps hook overall %s → %s', (overall, expected) => {
        const spy = jest.spyOn(status, 'computeHookStatus').mockReturnValue({ overall } as any);
        expect(strat.status(input(), provider)).toBe(expected);
        spy.mockRestore();
    });
});
