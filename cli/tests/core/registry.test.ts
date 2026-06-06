import { syncRegistry, REGISTRY_DIR, DEFAULT_REMOTE } from '../../src/core/registry';
import fs from 'fs';
import simpleGit from 'simple-git';
import { spawnSync } from 'child_process';

jest.mock('simple-git');
jest.mock('fs');
jest.mock('child_process');

const mockGit = {
    clone: jest.fn().mockResolvedValue(undefined),
    pull: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
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
        expect(mockGit.reset).toHaveBeenCalledWith(['--hard']);
        expect(mockGit.pull).toHaveBeenCalled();
    });

    it('should reset hard before pulling to discard local changes', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        const callOrder: string[] = [];
        mockGit.reset.mockImplementation(() => { callOrder.push('reset'); return Promise.resolve(); });
        mockGit.pull.mockImplementation(() => { callOrder.push('pull'); return Promise.resolve(); });

        await syncRegistry();

        expect(callOrder).toEqual(['reset', 'pull']);
    });

    it('should use a custom remote URL when provided', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);

        const customRemote = 'https://github.com/my-org/custom-registry.git';
        await syncRegistry(customRemote);

        expect(mockGit.clone).toHaveBeenCalledWith(customRemote, REGISTRY_DIR);
    });
});

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

describe('buildCli', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns success when npm run build exits 0', () => {
        mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from(''), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result).toEqual({ success: true });
        expect(mockSpawnSync).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: '/fake/cli', shell: true }));
    });

    it('returns failure with error message when build exits non-zero', () => {
        mockSpawnSync.mockReturnValue({ status: 1, stderr: Buffer.from('tsc error: Type mismatch'), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result.success).toBe(false);
        expect(result.error).toContain('tsc error');
    });

    it('returns failure with stdout message when tsc writes errors to stdout', () => {
        mockSpawnSync.mockReturnValue({ status: 2, stderr: Buffer.from(''), stdout: Buffer.from('error TS2322: Type mismatch'), pid: 1, output: [], signal: null });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result.success).toBe(false);
        expect((result as { success: false; error: string }).error).toContain('TS2322');
    });

    it('returns failure when spawnSync throws unexpectedly', () => {
        mockSpawnSync.mockImplementation(() => { throw new Error('unexpected error'); });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result.success).toBe(false);
        expect((result as { success: false; error: string }).error).toBe('unexpected error');
    });

    it('returns failure when npm is not found (shell returns status 127)', () => {
        mockSpawnSync.mockReturnValue({ status: 127, stderr: Buffer.from('/bin/sh: npm: not found'), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli } = require('../../src/core/registry');
        const result = buildCli('/fake/cli');
        expect(result.success).toBe(false);
        expect((result as { success: false; error: string }).error).toContain('not found');
    });

    it('uses REGISTRY_DIR/cli as default cwd', () => {
        mockSpawnSync.mockReturnValue({ status: 0, stderr: Buffer.from(''), stdout: Buffer.from(''), pid: 1, output: [], signal: null });
        const { buildCli, REGISTRY_DIR } = require('../../src/core/registry');
        buildCli();
        expect(mockSpawnSync).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ cwd: `${REGISTRY_DIR}/cli` }));
    });
});
