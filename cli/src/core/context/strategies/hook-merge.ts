// cli/src/core/context/strategies/hook-merge.ts
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';
import { InjectionStrategy } from './strategy';
import { installHook } from '../../../commands/hooks/install';
import { uninstallHook } from '../../../commands/hooks/uninstall';
import { computeHookStatus } from '../../../commands/hooks/status';

const STATE_BY_OVERALL: Record<string, InjectionState> = {
    HEALTHY: 'injected',
    DEGRADED: 'stale',
    NOT_INSTALLED: 'absent',
};

export class HookMergeStrategy implements InjectionStrategy {
    inject(input: InjectionInput, _provider: ProviderConfig): void {
        installHook({ agent: input.agent, registryRoot: input.registryRoot, installMethod: input.installMethod });
    }

    remove(input: InjectionInput, _provider: ProviderConfig): void {
        uninstallHook({ agent: input.agent });
    }

    status(input: InjectionInput, _provider: ProviderConfig): InjectionState {
        return STATE_BY_OVERALL[computeHookStatus(input.agent).overall] ?? 'absent';
    }
}
