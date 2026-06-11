// src/core/diagnostics/context.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { HarnessContext, MachineFacts, ProjectFacts, GitState } from './types';
import { PROVIDERS, AgentTarget } from '../../providers';
import { capabilityRoot } from '../registries';
import { InjectionOrchestrator } from '../context/orchestrator';
import { InjectionState } from '../context/types';
import { computeHookStatus } from '../../commands/hooks/status';
import { findProjectRoot, readProfile } from '../profile';
import { discoverAllBundles, resolveBundleSkills, BundleDefinition } from '../bundles';
import { classifyGlobalSkills } from '../skill-integrity';
import { contentRoots } from '../registries';

function home(): string { return process.env.HOME || os.homedir(); }
function awmHome(): string { return process.env.AWM_HOME || path.join(home(), '.awm'); }

// Estado de un artefacto en <dir>/<skill>: link vivo / symlink colgante / ausente.
function linkState(dir: string, skill: string): 'present' | 'broken' | 'absent' {
    const p = path.join(dir, skill);
    let lst: fs.Stats;
    try { lst = fs.lstatSync(p); } catch { return 'absent'; }
    if (lst.isSymbolicLink()) return fs.existsSync(p) ? 'present' : 'broken';
    return 'present'; // un dir/archivo real también cuenta como presente
}

function classifyLinks(skillNames: string[], dir: string): { linked: string[]; broken: string[] } {
    const linked: string[] = [];
    const broken: string[] = [];
    for (const s of skillNames) {
        const st = linkState(dir, s);
        if (st === 'present') linked.push(s);
        else if (st === 'broken') broken.push(s);
    }
    return { linked, broken };
}

function detectGitState(repoDir: string): GitState {
    try {
        const porcelain = execSync('git status --porcelain', { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
        if (porcelain.length > 0) return 'dirty';
        try {
            const behind = execSync('git rev-list --count HEAD..@{u}', { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
                .toString().trim();
            if (behind !== '' && behind !== '0') return 'behind';
        } catch { /* sin upstream configurado */ }
        return 'clean';
    } catch {
        return 'unknown';
    }
}

// Estado del contexto AWM para agentes cuyo mecanismo de inyección es config-instructions
// (hoy: opencode). claude-code usa el hook → ya se reporta como machine.hook, no se duplica.
// Sólo se reporta un agente si su archivo de config existe (señal de que el agente está en uso).
function gatherContextInjection(): { agent: AgentTarget; state: InjectionState }[] {
    const out: { agent: AgentTarget; state: InjectionState }[] = [];
    const orch = new InjectionOrchestrator();
    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        const inj = PROVIDERS[agent].injection;
        if (!inj || inj.type !== 'config-instructions') continue;
        if (!fs.existsSync(inj.configPath)) continue;
        let state: InjectionState = 'absent';
        try {
            state = orch.contextStatus({
                agent,
                scope: 'global',
                registryRoot: capabilityRoot('skills') ?? '',
                installMethod: 'symlink',
                profileExtensions: [],
            });
        } catch {
            // registry ausente u otra falla → tratar como ausente (no romper el doctor)
        }
        out.push({ agent, state });
    }
    return out;
}

function gatherMachine(bundles: BundleDefinition[], agent: AgentTarget = 'claude-code'): MachineFacts {
    // cliSource
    const cacheDir = path.join(awmHome(), 'cli-source');
    const cliPresent = fs.existsSync(path.join(cacheDir, '.git'));
    let version: string | undefined;
    let gitState: GitState | undefined;
    if (cliPresent) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(cacheDir, 'cli', 'package.json'), 'utf-8'));
            version = typeof pkg.version === 'string' ? pkg.version : undefined;
        } catch { /* deja version undefined */ }
        gitState = detectGitState(cacheDir);
    }

    // hook (reutiliza computeHookStatus)
    let hookPresent = false;
    let hookDegraded = false;
    try {
        const hs = computeHookStatus('claude-code');
        hookPresent = hs.checks.settingsEntry.ok;
        hookDegraded = hs.overall === 'DEGRADED';
    } catch { /* sin soporte de hooks → ausente */ }

    // devCore (bundle baseline)
    const skillsDir = PROVIDERS[agent].skill.global;
    const baseline = bundles.find((b) => b.scope === 'baseline');
    let devCorePresent = false;
    let brokenLinks: string[] = [];
    if (baseline) {
        const skillNames = resolveBundleSkills(baseline.name, bundles);
        const { linked, broken } = classifyLinks(skillNames, skillsDir);
        const absent = skillNames.filter((s) => !linked.includes(s) && !broken.includes(s));
        devCorePresent = skillNames.length > 0 && (linked.length + broken.length) > 0;
        brokenLinks = [...broken, ...absent];
    }

    // ambient (deseados desde ~/.awm/config.json)
    let wanted: string[] = [];
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(awmHome(), 'config.json'), 'utf-8'));
        if (Array.isArray(cfg.ambient)) {
            wanted = cfg.ambient.filter((x: unknown): x is string => typeof x === 'string');
        }
    } catch { /* sin config → ningún ambient deseado */ }
    const installed = wanted.filter((name) => {
        const skillNames = resolveBundleSkills(name, bundles);
        if (skillNames.length === 0) return false;
        const { linked } = classifyLinks(skillNames, skillsDir);
        return linked.length === skillNames.length;
    });

    return {
        cliSource: { present: cliPresent, version, gitState },
        hook: { present: hookPresent, degraded: hookDegraded },
        devCore: { present: devCorePresent, brokenLinks },
        ambient: { wanted, installed },
        contextInjection: gatherContextInjection(),
        globalSkills: classifyGlobalSkills(skillsDir, contentRoots()),
    };
}

function gatherProject(root: string, bundles: BundleDefinition[], agent: AgentTarget = 'claude-code'): ProjectFacts {
    const profile = readProfile(root);
    const profilePresent = fs.existsSync(path.join(root, '.awm', 'profile.json'));

    const localSkillsDir = path.join(root, PROVIDERS[agent].skill.local);
    const expected: string[] = [];
    for (const ext of profile.extensions) {
        for (const s of resolveBundleSkills(ext, bundles)) if (!expected.includes(s)) expected.push(s);
    }
    const { linked, broken } = classifyLinks(expected, localSkillsDir);

    let context: ProjectFacts['context'] = { present: false };
    if (fs.existsSync(path.join(root, 'CLAUDE.md'))) context = { present: true, file: 'CLAUDE.md' };
    else if (fs.existsSync(path.join(root, 'AGENTS.md'))) context = { present: true, file: 'AGENTS.md' };

    return {
        root,
        profile: { present: profilePresent, extensions: profile.extensions },
        activeBundles: { expected, linked, broken },
        sensors: { present: fs.existsSync(path.join(root, '.awm', 'sensors.json')) },
        constitution: { present: fs.existsSync(path.join(root, 'CONSTITUTION.md')) },
        context,
    };
}

export interface GatherOptions {
    cwd?: string;
    bundles?: BundleDefinition[];
    agent?: AgentTarget;
}

export function gatherContext(opts: GatherOptions = {}): HarnessContext {
    const cwd = opts.cwd ?? process.cwd();
    const bundles = opts.bundles ?? discoverAllBundles();
    const agent = opts.agent ?? 'claude-code';
    const root = findProjectRoot(cwd);
    return {
        machine: gatherMachine(bundles, agent),
        project: root ? gatherProject(root, bundles, agent) : null,
    };
}
