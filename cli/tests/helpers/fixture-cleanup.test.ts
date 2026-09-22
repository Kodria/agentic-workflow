import fs from 'fs';
import { removeFixtureTree } from './fixture-cleanup';

describe('removeFixtureTree', () => {
    it('uses bounded native retries for transient filesystem locks', () => {
        const remove = jest.fn<void, Parameters<typeof fs.rmSync>>();

        removeFixtureTree('/tmp/fixture', remove);

        expect(remove).toHaveBeenCalledWith('/tmp/fixture', {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 50,
        });
    });

    it.each(['', 'relative-fixture'])('rejects an unsafe fixture path %j', target => {
        expect(() => removeFixtureTree(target)).toThrow('fixture cleanup requires an absolute path');
    });
});
