import fs from 'fs';
import path from 'path';

const watchRoot = path.resolve(__dirname, '../../../src/commands/watch');

describe('watch state dependency boundary', () => {
    test('teardown driver consumes shared state through the neutral track-state module', () => {
        const source = fs.readFileSync(path.join(watchRoot, 'teardown-driver.ts'), 'utf8');

        expect(source).toContain("from './track-state'");
        expect(source).not.toMatch(/from '\.\/tracks';/);
    });
});
