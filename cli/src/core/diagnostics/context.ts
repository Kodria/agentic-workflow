// src/core/diagnostics/context.ts
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { HarnessContext, MachineFacts, ProjectFacts, GitState } from './types';
import { AGENT_TARGETS, AgentTarget, RendererId, providerFor } from '../../providers';
import { renderedFilename } from '../renderers/registry';
import { capabilityRoot, listRegistries, contentRoots } from '../registries';
import { InjectionOrchestrator } from '../context/orchestrator';
import { InjectionState } from '../context/types';
import { computeHookStatus } from '../../commands/hooks/status';
import { findProjectRoot, readProfile } from '../profile';
import { discoverAllBundles, resolveBundleSkills, resolveBundleAgents, BundleDefinition } from '../bundles';
import { classifySkillLinks } from '../skill-integrity';
import { awmHome } from '../paths';
import { gatherProviderChecks, ScanSkills } from './provider-checks';

// Estado de un artefacto en <dir>/<skill>: link vivo / symlink colgante / ausente.
function linkState(dir: string, skill: string): 'present' | 'broken' | 'absent' {
    const p = path.join(dir, skill);
    let lst: fs.Stats;
    try { lst = fs.lstatSync(p); } catch { return 'absent'; }
    if (lst.isSymbolicLink()) return fs.existsSync(p) ? 'present' : 'broken';
    return 'present'; // un dir/archivo real también cuenta como presente
}

/** Clasifica artefactos por su presencia en disco.
 *
 *  `renderer` NO es opcional a proposito. El escritor (`physicalTarget`) estampa
 *  la extension del renderer sobre el nombre — `using-awm.mdc`,
 *  `using-awm.instructions.md` — y este lector buscaba el nombre pelado
 *  (`using-awm`), asi que para Cursor y Copilot NADA figuraba nunca como
 *  instalado: `awm init` reinstalaba el baseline completo en cada corrida (2
 *  directorios de backup sin podar por corrida) y `awm doctor` mostraba un rojo
 *  permanente cuyo remedio no podia satisfacerlo. Exigir el renderer obliga a
 *  cada caller a declarar de que artefacto habla, y `renderedFilename` es la
 *  misma funcion que usa el escritor — no pueden volver a discrepar.
 *
 *  Los nombres devueltos son los LOGICOS (los de entrada), no los fisicos: los
 *  consumidores comparan contra listas de nombres de bundle. */
function classifyLinks(names: string[], dir: string, renderer: RendererId): { linked: string[]; broken: string[] } {
    const linked: string[] = [];
    const broken: string[] = [];
    for (const name of names) {
        const st = linkState(dir, renderedFilename(name, renderer));
        if (st === 'present') linked.push(name);
        else if (st === 'broken') broken.push(name);
    }
    return { linked, broken };
}

function detectGitState(repoDir: string): GitState {
    try {
        const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
            .toString().trim();
        if (porcelain.length > 0) return 'dirty';
        try {
            const behind = execFileSync('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, encoding: 'utf8' })
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
    for (const agent of AGENT_TARGETS) {
        const inj = providerFor(agent).injection;
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

function gatherMachine(bundles: BundleDefinition[], agent: AgentTarget = 'claude-code', projectRoot?: string): MachineFacts {
    // registryCache: estado del primer registry configurado (baseline en una máquina sembrada)
    const regs = listRegistries();
    const first = regs[0];
    const cachePresent = !!first && fs.existsSync(path.join(first.contentRoot, '.git'));
    const gitState = cachePresent ? detectGitState(first.contentRoot) : undefined;

    // hook (reutiliza computeHookStatus) — Task 9 fix: this used to be hardcoded to
    // 'claude-code' regardless of `agent`, so `awm init --agent codex`'s own hook
    // precondition silently read CLAUDE's hook status instead of Codex's. Whenever
    // Claude's hook was already installed, stepHook would then wrongly conclude
    // Codex's hook was "already present" and skip installing it (R18 regression —
    // caught while building this task's real end-to-end init test).
    let hookPresent = false;
    let hookDegraded = false;
    // La aplicabilidad se computa DONDE el provider esta en alcance, no se
    // infiere de que `computeHookStatus` haya tirado (un throw puede ser "no
    // soporta hooks" o un error real, y confundirlos fue el bug).
    const hookApplicable = providerFor(agent).hooks !== undefined;
    if (hookApplicable) {
        try {
            const hs = computeHookStatus(agent);
            hookPresent = hs.checks.settingsEntry.ok;
            hookDegraded = hs.overall === 'DEGRADED';
        } catch { /* soporta hooks pero no se pudo leer el estado → ausente */ }
    }

    // devCore (bundle baseline) — skillsDir is null only for providers with no global skill
    // discovery mechanism (today: Copilot); for those, there is no global-scope devCore
    // concept to satisfy at all, so it's treated as trivially satisfied (see below).
    const skillsDir = providerFor(agent).skill.global;
    // TODOS los baseline, igual que `stepDevCore` los instala y que
    // `reconciliation.ts` los reconcilia. Con `find`, el hecho que decide si el
    // baseline esta satisfecho miraba solo el primero, asi que un segundo bundle
    // baseline sin instalar reportaba `healthy` — y el step, que lee este mismo
    // hecho, nunca lo instalaba.
    const baselines = bundles.filter((b) => b.scope === 'baseline');
    const baseline = baselines[0];
    let devCorePresent = false;
    let brokenLinks: string[] = [];
    if (baseline) {
        const skillNames = [...new Set(baselines.flatMap((b) => resolveBundleSkills(b.name, bundles)))];
        if (skillsDir === null) {
            // No global skill directory for this agent (today: Copilot) — there is no
            // global-scope devCore/baseline-bundle concept to satisfy for it at all, so
            // "N/A" is reported as satisfied (present, nothing broken) rather than
            // "missing". Mirrors globalSkills' treatment just below (empty valid/
            // repairable/dead when skillsDir === null). Without this, devCorePresent
            // was unconditionally false here (linked/broken forced to empty arrays),
            // so `machine.devCore` could never be satisfied for Copilot — stepDevCore
            // (init/steps.ts) would fall through on every run and call installBundle at
            // global scope, which throws (skill.global === null), rolling back the
            // ENTIRE `awm init -a copilot` transaction, 100% of the time.
            // Sin directorio global de skills (hoy: Copilot) el baseline se
            // instala a nivel PROYECTO — `stepDevCore` lo hace con
            // scopeOverride 'local'. Antes esto se declaraba "trivialmente
            // satisfecho" incondicionalmente: eso evitaba el crash-loop del
            // install global, pero significaba que Copilot terminaba con CERO
            // skills mientras init imprimia `✔ dev-core` y doctor decia
            // `healthy`. Ahora se mira donde el artefacto REALMENTE va.
            if (projectRoot) {
                const localDir = path.join(projectRoot, providerFor(agent).skill.local);
                const { linked, broken } = classifyLinks(skillNames, localDir, providerFor(agent).skill.renderer);
                const absent = skillNames.filter((s) => !linked.includes(s) && !broken.includes(s));
                devCorePresent = skillNames.length > 0 && (linked.length + broken.length) > 0;
                brokenLinks = [...broken, ...absent];
            } else {
                // Fuera de un proyecto no hay destino local: no hay nada que
                // reclamar como faltante.
                devCorePresent = true;
            }
        } else {
            const { linked, broken } = classifyLinks(skillNames, skillsDir, providerFor(agent).skill.renderer);
            const absent = skillNames.filter((s) => !linked.includes(s) && !broken.includes(s));
            devCorePresent = skillNames.length > 0 && (linked.length + broken.length) > 0;
            brokenLinks = [...broken, ...absent];
        }

        // Agent-type artifacts are never shared across agents (R12/R13 —
        // install-planner.ts — unlike skills, where OpenCode and Codex both
        // resolve to ~/.agents/skills). A shared skill directory already
        // linked by a co-owner agent must not make THIS agent's own native
        // agent artifacts look "present" when they were never installed for
        // it specifically — otherwise stepDevCore (init/steps.ts) would skip
        // re-running and Codex would never get its .toml rendered on a
        // machine where OpenCode was initialized first. Found while building
        // the real Codex+OpenCode coexistence E2E test
        // (tests/integration/codex-provider-isolated.test.ts).
        const agentConfig = providerFor(agent).agent;
        if (agentConfig && agentConfig.global !== null) {
            const agentNames = [...new Set(baselines.flatMap((b) => resolveBundleAgents(b.name, bundles)))];
            if (agentNames.length > 0) {
                // El installName real de un artefacto `agent` es `<n>.md`
                // (bundle-install.ts), y el renderer decide la extension final:
                // `.toml` para codex, `.md` tal cual para los renderers `link`.
                // El ternario anterior devolvia `n` pelado para `link`, asi que
                // `machine.devCore` quedaba permanentemente roto para
                // claude-code — el provider por DEFECTO — contra el registry real.
                const filenames = agentNames.map((n) => `${n}.md`);
                const { linked: agentLinked, broken: agentBroken } = classifyLinks(filenames, agentConfig.global, agentConfig.renderer);
                const agentAbsent = filenames.filter((f) => !agentLinked.includes(f) && !agentBroken.includes(f));
                // `brokenLinks` es de diagnostico: se le muestra al usuario para
                // que vaya a buscar ese archivo. Por eso se reportan los nombres
                // FISICOS (`development-process.toml`), aunque la clasificacion
                // trabaje con los logicos — que es lo que necesitan las
                // comparaciones por cantidad de arriba.
                const physical = (n: string) => renderedFilename(n, agentConfig.renderer);
                brokenLinks = [...brokenLinks, ...agentBroken.map(physical), ...agentAbsent.map(physical)];
            }
        }
    }

    // ambient (deseados desde ~/.awm/config.json)
    let wanted: string[] = [];
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(awmHome(), 'config.json'), 'utf-8'));
        if (Array.isArray(cfg.ambient)) {
            wanted = cfg.ambient.filter((x: unknown): x is string => typeof x === 'string');
        }
    } catch { /* sin config → ningún ambient deseado */ }
    // Same guard as devCorePresent above: an agent with no global skill
    // directory (today: Copilot) has no way to ever receive a globally-
    // installed ambient bundle either — there is no global-scope "ambient"
    // concept to satisfy for it at all. Without this, `installed` was forced
    // to `[]` unconditionally for Copilot regardless of `wanted`, so
    // stepAmbient (init/steps.ts) would treat every entry of a machine-level
    // `~/.awm/config.json`'s `ambient` array as permanently missing and call
    // installBundle at global scope — which throws for Copilot exactly like
    // the devCore bug this file already fixes. Reported as "N/A == already
    // satisfied" (installed), not "wanted but always missing".
    const installed = skillsDir === null ? [...wanted] : wanted.filter((name) => {
        const skillNames = resolveBundleSkills(name, bundles);
        if (skillNames.length === 0) return false;
        const { linked } = classifyLinks(skillNames, skillsDir, providerFor(agent).skill.renderer);
        return linked.length === skillNames.length;
    });

    return {
        registryCache: { present: cachePresent, gitState },
        hook: { present: hookPresent, degraded: hookDegraded, applicable: hookApplicable },
        devCore: { present: devCorePresent, brokenLinks },
        ambient: { wanted, installed },
        contextInjection: gatherContextInjection(),
        globalSkills: skillsDir !== null
            ? classifySkillLinks(skillsDir, contentRoots())
            : { valid: [], repairable: [], dead: [] },
    };
}

function gatherProject(root: string, bundles: BundleDefinition[], agent: AgentTarget = 'claude-code'): ProjectFacts {
    const profile = readProfile(root);
    const profilePresent = fs.existsSync(path.join(root, '.awm', 'profile.json'));

    const localSkillsDir = path.join(root, providerFor(agent).skill.local);
    const expected: string[] = [];
    for (const ext of profile.extensions) {
        for (const s of resolveBundleSkills(ext, bundles)) if (!expected.includes(s)) expected.push(s);
    }
    const { linked, broken } = classifyLinks(expected, localSkillsDir, providerFor(agent).skill.renderer);

    // Huerfanos: symlinks colgantes que el profile ya no reclama. Se clasifican sobre
    // el dir REAL, no sobre la lista esperada — que es justamente lo que `linked`/
    // `broken` de arriba no pueden ver. `awm sync` los cura o los poda.
    const orphanScan = classifySkillLinks(localSkillsDir, contentRoots());
    const orphanLinks = {
        repairable: orphanScan.repairable.filter((n) => !expected.includes(n)),
        dead: orphanScan.dead.filter((n) => !expected.includes(n)),
    };

    let context: ProjectFacts['context'] = { present: false };
    if (fs.existsSync(path.join(root, 'CLAUDE.md'))) context = { present: true, file: 'CLAUDE.md' };
    else if (fs.existsSync(path.join(root, 'AGENTS.md'))) context = { present: true, file: 'AGENTS.md' };

    return {
        root,
        profile: { present: profilePresent, extensions: profile.extensions },
        activeBundles: { expected, linked, broken },
        orphanLinks,
        sensors: { present: fs.existsSync(path.join(root, '.awm', 'sensors.json')) },
        constitution: { present: fs.existsSync(path.join(root, 'CONSTITUTION.md')) },
        context,
    };
}

export interface GatherOptions {
    cwd?: string;
    bundles?: BundleDefinition[];
    agent?: AgentTarget;
    /** Task 9: agents to build the `.providers` diagnostic matrix for. Defaults to `[agent]`
     *  (or `['claude-code']`) so existing single-agent callers (init/steps.ts) are unaffected. */
    agents?: AgentTarget[];
    /** Injectable seam over the physical skills-dir scan (default: classifySkillLinks) —
     *  tests spy on this to assert a directory shared by two providers is scanned once. */
    scanSkills?: ScanSkills;
}

export function gatherContext(opts: GatherOptions = {}): HarnessContext {
    const cwd = opts.cwd ?? process.cwd();
    const bundles = opts.bundles ?? discoverAllBundles();
    const agent = opts.agent ?? 'claude-code';
    const root = findProjectRoot(cwd);
    const agents = opts.agents ?? [agent];
    const scanSkills = opts.scanSkills ?? ((dir: string) => classifySkillLinks(dir, contentRoots()));
    return {
        machine: gatherMachine(bundles, agent, root ?? undefined),
        project: root ? gatherProject(root, bundles, agent) : null,
        providers: gatherProviderChecks(agents, scanSkills, root ?? undefined),
    };
}
