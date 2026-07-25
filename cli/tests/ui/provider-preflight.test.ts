import {
    preflightLinkArtifactsForCli,
} from '../../src/ui/provider-preflight';

describe.each(['--all', 'regular'])('%s add preflight boundary', (flow) => {
    it('reports the exact error and stops before install or preference writes', () => {
        const error = jest.fn();
        const exit = jest.fn();
        const installArtifact = jest.fn();
        const savePreferences = jest.fn();
        const pairs = [
            { agent: 'codex' as const, artifact: { type: 'skill' as const } },
            { agent: 'codex' as const, artifact: { type: 'agent' as const } },
        ];

        const proceed = preflightLinkArtifactsForCli(pairs, { error, exit });
        if (proceed) {
            installArtifact(flow);
            savePreferences(flow);
        }

        expect(proceed).toBe(false);
        expect(error).toHaveBeenCalledWith(
            "Renderer 'codex-agent-toml' for codex agent artifacts is not implemented yet",
        );
        expect(exit).toHaveBeenCalledWith(1);
        expect(installArtifact).not.toHaveBeenCalled();
        expect(savePreferences).not.toHaveBeenCalled();
    });
});
