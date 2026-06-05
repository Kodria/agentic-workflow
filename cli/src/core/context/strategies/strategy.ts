// cli/src/core/context/strategies/strategy.ts
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';

export interface InjectionStrategy {
    inject(input: InjectionInput, provider: ProviderConfig): void;
    remove(input: InjectionInput, provider: ProviderConfig): void;
    status(input: InjectionInput, provider: ProviderConfig): InjectionState;
}
