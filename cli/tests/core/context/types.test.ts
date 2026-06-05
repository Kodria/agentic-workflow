// cli/tests/core/context/types.test.ts
import { AwmContext, MaterializedRef, InjectionState, InjectionInput } from '../../../src/core/context/types';

describe('context contracts', () => {
    it('compiles AwmContext / MaterializedRef / InjectionInput with the expected shape', () => {
        const ctx: AwmContext = { markdown: '# AWM', sourceVersion: '1.0.0', contentHash: 'abc' };
        const ref: MaterializedRef = { absPath: '/tmp/awm-context.md', scope: 'global', contentHash: 'abc' };
        const input: InjectionInput = {
            ref, registryRoot: '/reg', installMethod: 'symlink', agent: 'opencode', scope: 'global',
        };
        const states: InjectionState[] = ['injected', 'absent', 'stale'];
        expect(ctx.contentHash).toBe(ref.contentHash);
        expect(input.agent).toBe('opencode');
        expect(states).toHaveLength(3);
    });
});
