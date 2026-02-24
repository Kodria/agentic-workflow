import { syncRegistry, REGISTRY_DIR, DEFAULT_REMOTE } from '../../src/core/registry';
import fs from 'fs';
import simpleGit from 'simple-git';

jest.mock('simple-git');
jest.mock('fs');

const mockGit = {
    clone: jest.fn().mockResolvedValue(undefined),
    pull: jest.fn().mockResolvedValue(undefined),
};

(simpleGit as unknown as jest.Mock).mockReturnValue(mockGit);

describe('Registry Manager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should clone the repository if the registry directory does not exist', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);

        await syncRegistry();

        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        expect(mockGit.clone).toHaveBeenCalledWith(DEFAULT_REMOTE, REGISTRY_DIR);
    });

    it('should pull if the registry directory already exists', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);

        await syncRegistry();

        expect(mockGit.clone).not.toHaveBeenCalled();
        expect(mockGit.pull).toHaveBeenCalled();
    });

    it('should use a custom remote URL when provided', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);

        const customRemote = 'https://github.com/my-org/custom-registry.git';
        await syncRegistry(customRemote);

        expect(mockGit.clone).toHaveBeenCalledWith(customRemote, REGISTRY_DIR);
    });
});
