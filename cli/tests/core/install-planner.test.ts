import fs from 'fs';
import os from 'os';
import path from 'path';
import { planInstall, planRemoval, agentsSharingSkillTarget, ArtifactIntent } from '../../src/core/install-planner';
import { ManagedArtifactRecord } from '../../src/core/artifact-state';
import { AgentTarget } from '../../src/providers';

describe('install-planner', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        // Isolate ~ (and thus provider global paths, per CLAUDE.md: no test may
        // touch the real ~/.awm or ~/.agents). HOME also drives providerFor()'s
        // global dirs, which is exactly what makes opencode/codex "share" a
        // physical skills directory in these tests.
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-planner-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-planner-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function skillArtifact(name: string): ArtifactIntent {
        return {
            name,
            installName: name,
            type: 'skill',
            sourcePath: path.join(tmpWork, 'registry', 'skills', name),
        };
    }

    function agentArtifact(name: string): ArtifactIntent {
        return {
            name,
            installName: `${name}.md`,
            type: 'agent',
            sourcePath: path.join(tmpWork, 'registry', 'agents', `${name}.md`),
        };
    }

    function workflowArtifact(name: string): ArtifactIntent {
        return {
            name,
            installName: `${name}.md`,
            type: 'workflow',
            sourcePath: path.join(tmpWork, 'registry', 'workflows', `${name}.md`),
        };
    }

    function recordOwnedBy(name: string, owners: AgentTarget[]): ManagedArtifactRecord {
        return {
            name,
            type: 'skill',
            scope: 'global',
            targetPath: path.join(tmpHome, '.agents', 'skills', name),
            sourcePath: path.join(tmpWork, 'registry', 'skills', name),
            renderer: 'link',
            owners,
        };
    }

    describe('agentsSharingSkillTarget', () => {
        it('excludes a candidate that does not support this scope at all, instead of throwing', () => {
            // Regression: used to call skillTargetDir(candidate, ...) unguarded
            // inside .filter() — Copilot at 'global' throws (no global skill
            // dir), which crashed the whole call for every OTHER candidate too.
            const group = agentsSharingSkillTarget('claude-code', ['claude-code', 'copilot'], 'global', tmpWork);
            expect(group).toEqual(['claude-code']);
        });

        it('still finds real shared targets when a non-sharing, scope-unsupported candidate is also present', () => {
            const group = agentsSharingSkillTarget('opencode', ['opencode', 'codex', 'copilot'], 'global', tmpWork);
            expect(group.sort()).toEqual(['codex', 'opencode']);
        });
    });

    describe('planInstall', () => {
        it('deduplicates the OpenCode/Codex physical skill write and reports both owners', () => {
            const plan = planInstall({
                artifacts: [skillArtifact('development-process')],
                selectedAgents: ['opencode', 'codex'],
                enabledAgents: ['claude-code', 'opencode', 'codex'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan.operations).toHaveLength(1); // verifies R15
            expect(plan.operations[0].owners).toEqual(['opencode', 'codex']); // verifies R15.1
        });

        it('aborts a skill change for an incomplete shared target group before writes', () => {
            expect(() => planInstall({
                artifacts: [skillArtifact('development-process')],
                selectedAgents: ['codex'],
                enabledAgents: ['opencode', 'codex'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            })).toThrow('select the complete shared target group: opencode,codex'); // verifies R14
        });

        it('does not apply the shared-domain restriction to independently addressed agents', () => {
            const plan = planInstall({
                artifacts: [agentArtifact('development-process')],
                selectedAgents: ['codex'],
                enabledAgents: ['opencode', 'codex'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan.operations[0].owners).toEqual(['codex']); // verifies R13
        });

        it('does not crash when a provider with no global skill support (Copilot) is merely enabled, not selected', () => {
            // Regression: assertCompleteSharedGroup's inner `enabled.filter(...)`
            // used to call physicalTarget() unguarded for every enabled agent,
            // including ones that don't support this scope at all (Copilot has
            // no global skill directory — skill.global is null). That threw
            // inside the filter callback, uncaught, crashing this ENTIRE
            // install for claude-code even though Copilot has nothing to do
            // with it — just having Copilot in enabledAgents (e.g. from an
            // earlier local-scope install) broke every subsequent global
            // install for every other agent.
            const plan = planInstall({
                artifacts: [skillArtifact('development-process')],
                selectedAgents: ['claude-code'],
                enabledAgents: ['claude-code', 'copilot'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan.operations[0].owners).toEqual(['claude-code']);
        });

        it('returns no operations for an empty artifacts array', () => {
            const plan = planInstall({
                artifacts: [],
                selectedAgents: ['claude-code'],
                enabledAgents: ['claude-code'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan).toEqual({ operations: [], records: [], reports: [] });
        });

        it('returns no operations for an empty selectedAgents array', () => {
            const plan = planInstall({
                artifacts: [skillArtifact('development-process')],
                selectedAgents: [],
                enabledAgents: ['claude-code'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan).toEqual({ operations: [], records: [], reports: [] });
        });

        it('skips an artifact type unsupported by an agent instead of throwing (workflow on claude-code)', () => {
            const plan = planInstall({
                artifacts: [workflowArtifact('wf-ext')],
                selectedAgents: ['claude-code'],
                enabledAgents: ['claude-code'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan.operations).toEqual([]);
        });

        it('resolves a local-scope target beneath projectRoot', () => {
            const plan = planInstall({
                artifacts: [skillArtifact('development-process')],
                selectedAgents: ['claude-code'],
                enabledAgents: ['claude-code'],
                scope: 'local',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan.operations[0].targetPath).toBe(
                path.join(tmpWork, '.claude', 'skills', 'development-process'),
            );
        });

        it('dedupes two intents that share both targetPath and sourcePath into one operation', () => {
            // e.g. the same skill pulled in twice via different bundles in a
            // closure — same physical target, same backing source: fine.
            const plan = planInstall({
                artifacts: [skillArtifact('development-process'), skillArtifact('development-process')],
                selectedAgents: ['claude-code'],
                enabledAgents: ['claude-code'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            });
            expect(plan.operations).toHaveLength(1);
        });

        it('throws when two intents share a targetPath but have different sourcePaths', () => {
            // e.g. the same skill name shipped by two different registries —
            // one physical target can't be backed by two different sources.
            const registryA: ArtifactIntent = {
                name: 'development-process',
                installName: 'development-process',
                type: 'skill',
                sourcePath: path.join(tmpWork, 'registry-a', 'skills', 'development-process'),
            };
            const registryB: ArtifactIntent = {
                name: 'development-process',
                installName: 'development-process',
                type: 'skill',
                sourcePath: path.join(tmpWork, 'registry-b', 'skills', 'development-process'),
            };
            expect(() => planInstall({
                artifacts: [registryA, registryB],
                selectedAgents: ['claude-code'],
                enabledAgents: ['claude-code'],
                scope: 'global',
                projectRoot: tmpWork,
                method: 'symlink',
            })).toThrow(/physical target already claimed by a different source/);
        });

        describe('renderer-driven filename computation (Task 4.3)', () => {
            it('renders the Cursor skill target with a .mdc extension, stripping any pre-existing extension', () => {
                const plan = planInstall({
                    artifacts: [skillArtifact('development-process')],
                    selectedAgents: ['cursor'],
                    enabledAgents: ['cursor'],
                    scope: 'local',
                    projectRoot: tmpWork,
                    method: 'symlink',
                });
                expect(plan.operations[0].targetPath).toBe(
                    path.join(tmpWork, '.cursor', 'rules', 'development-process.mdc'),
                );
                expect(plan.operations[0].renderer).toBe('cursor-mdc');
            });

            it('renders the Copilot skill target with a .instructions.md extension (not .md.instructions.md)', () => {
                const plan = planInstall({
                    artifacts: [skillArtifact('development-process')],
                    selectedAgents: ['copilot'],
                    enabledAgents: ['copilot'],
                    scope: 'local',
                    projectRoot: tmpWork,
                    method: 'symlink',
                });
                expect(plan.operations[0].targetPath).toBe(
                    path.join(tmpWork, '.github', 'instructions', 'development-process.instructions.md'),
                );
                expect(plan.operations[0].renderer).toBe('copilot-instructions');
            });

            it('strips an installName that already carries an extension before appending .instructions.md', () => {
                const withExtension: ArtifactIntent = {
                    name: 'development-process',
                    installName: 'development-process.md',
                    type: 'skill',
                    sourcePath: path.join(tmpWork, 'registry', 'skills', 'development-process'),
                };
                const plan = planInstall({
                    artifacts: [withExtension],
                    selectedAgents: ['copilot'],
                    enabledAgents: ['copilot'],
                    scope: 'local',
                    projectRoot: tmpWork,
                    method: 'symlink',
                });
                expect(path.basename(plan.operations[0].targetPath)).toBe('development-process.instructions.md');
            });
        });
    });

    describe('planRemoval', () => {
        it('retains a target while a non-selected enabled owner remains', () => {
            const result = planRemoval({
                records: [recordOwnedBy('development-process', ['opencode', 'codex'])],
                selectedAgents: ['codex'],
                enabledAgents: ['opencode', 'codex'],
                artifactNames: ['development-process'],
            });
            expect(result.operations).toEqual([]);
            expect(result.records[0].owners).toEqual(['opencode']); // verifies R16
        });

        it('produces an unlink once the last enabled owner is removed', () => {
            const result = planRemoval({
                records: [recordOwnedBy('development-process', ['codex'])],
                selectedAgents: ['codex'],
                enabledAgents: ['opencode', 'codex'],
                artifactNames: ['development-process'],
            });
            expect(result.records).toEqual([]);
            expect(result.operations).toHaveLength(1);
            expect(result.operations[0].action).toBe('unlink');
        });

        it('leaves records for artifacts not named in artifactNames untouched', () => {
            const other = recordOwnedBy('other-skill', ['codex']);
            const result = planRemoval({
                records: [other],
                selectedAgents: ['codex'],
                enabledAgents: ['opencode', 'codex'],
                artifactNames: ['development-process'],
            });
            expect(result.records).toEqual([other]);
            expect(result.operations).toEqual([]);
        });
    });
});
