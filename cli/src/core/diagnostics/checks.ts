// src/core/diagnostics/checks.ts
import path from 'path';
import { HarnessContext, MachineFacts, ProjectFacts, CheckResult, CheckReport, Remedy, ProviderFacts, ProviderCheckState } from './types';

const cmd = (value: string): Remedy => ({ kind: 'command', value });
const skillRemedy = (value: string): Remedy => ({ kind: 'skill', value });
const none: Remedy = { kind: 'none' };

function machineChecks(m: MachineFacts): CheckResult[] {
    const out: CheckResult[] = [];

    // machine.cli
    if (!m.registryCache.present) {
        out.push({ id: 'machine.cli', level: 'machine', label: 'CLI', status: 'missing',
            detail: 'registry cache missing — run awm init', remedy: cmd('awm init') });
    } else if (m.registryCache.gitState === 'clean') {
        out.push({ id: 'machine.cli', level: 'machine', label: 'CLI', status: 'ok', remedy: none });
    } else if (m.registryCache.gitState === 'behind') {
        out.push({ id: 'machine.cli', level: 'machine', label: 'CLI', status: 'warn',
            detail: 'cache out of date', remedy: cmd('awm update') });
    } else {
        // dirty | unknown | undefined → advisory, sin acción
        out.push({ id: 'machine.cli', level: 'machine', label: 'CLI', status: 'warn',
            detail: `git ${m.registryCache.gitState ?? 'unknown'}`, remedy: none });
    }

    // machine.hook
    // Un provider sin mecanismo de hooks no puede "tener el hook instalado":
    // no se emite fila alguna, igual que ya hacen el paso de init
    // (init/steps.ts, "no hook mechanism for this agent") y el reporte por
    // provider (provider-checks.ts, que descarta la fila). Emitir `missing`
    // aca era lo que ponia `awm init` en exit 1 para 4 de los 6 providers.
    if (!m.hook.applicable) {
        // sin fila
    } else if (m.hook.present && !m.hook.degraded) {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'ok', remedy: none });
    } else if (m.hook.present) {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'warn',
            detail: 'incomplete scripts', remedy: cmd('awm init') });
    } else {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'missing',
            remedy: cmd('awm init') });
    }

    // machine.devCore
    if (m.devCore.present && m.devCore.brokenLinks.length === 0) {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'ok', remedy: none });
    } else if (m.devCore.present) {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'warn',
            detail: `${m.devCore.brokenLinks.length} broken symlinks`, remedy: cmd('awm init') });
    } else {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'missing',
            remedy: cmd('awm init') });
    }

    // machine.globalSkills — integridad de symlinks en ~/.claude/skills (fuera del baseline)
    const brokenGlobal = m.globalSkills.repairable.length + m.globalSkills.dead.length;
    if (brokenGlobal === 0) {
        out.push({ id: 'machine.globalSkills', level: 'machine', label: 'global skills', status: 'ok', remedy: none });
    } else {
        out.push({ id: 'machine.globalSkills', level: 'machine', label: 'global skills', status: 'warn',
            detail: `${brokenGlobal} broken links`, remedy: cmd('awm init') });
    }

    // machine.ambient.<b> — una fila por bundle deseado
    for (const b of m.ambient.wanted) {
        const installed = m.ambient.installed.includes(b);
        out.push({ id: `machine.ambient.${b}`, level: 'machine', label: `${b} (ambient)`,
            status: installed ? 'ok' : 'missing', remedy: installed ? none : cmd(`awm add ${b}`) });
    }

    // machine.context.<agent> — una fila por agente con contexto AWM gestionado
    for (const c of m.contextInjection) {
        if (c.state === 'injected') {
            out.push({ id: `machine.context.${c.agent}`, level: 'machine', label: `AWM context (${c.agent})`,
                status: 'ok', remedy: none });
        } else if (c.state === 'stale') {
            out.push({ id: `machine.context.${c.agent}`, level: 'machine', label: `AWM context (${c.agent})`,
                status: 'warn', detail: 'context out of date', remedy: cmd('awm init') });
        } else {
            out.push({ id: `machine.context.${c.agent}`, level: 'machine', label: `AWM context (${c.agent})`,
                status: 'missing', remedy: cmd('awm init') });
        }
    }

    return out;
}

function projectChecks(p: ProjectFacts): CheckResult[] {
    const out: CheckResult[] = [];

    // project.profile
    if (p.profile.present) {
        const exts = p.profile.extensions.length ? p.profile.extensions.join(', ') : 'no extensions';
        out.push({ id: 'project.profile', level: 'project', label: `.awm/profile.json (${exts})`,
            status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.profile', level: 'project', label: '.awm/profile.json', status: 'missing',
            remedy: cmd('awm init') });
    }

    // project.activation
    const missingLinks = p.activeBundles.expected.filter((s) => !p.activeBundles.linked.includes(s));
    if (p.activeBundles.broken.length === 0 && missingLinks.length === 0) {
        out.push({ id: 'project.activation', level: 'project', label: 'active bundles', status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.activation', level: 'project', label: 'active bundles', status: 'missing',
            detail: `${missingLinks.length} missing, ${p.activeBundles.broken.length} broken`, remedy: cmd('awm sync') });
    }

    // project.orphans — links colgantes que ya no pertenecen a ninguna extension.
    // Fila propia y no parte de `project.activation`: ese check mide "falta lo que el
    // profile pide", y esto es lo contrario — sobra lo que el profile ya no pide. Sin
    // separarlos, un proyecto con todo lo esperado instalado reportaba `ok` mientras
    // arrastraba skills muertas que el agente sigue intentando leer.
    const orphans = p.orphanLinks.repairable.length + p.orphanLinks.dead.length;
    if (orphans > 0) {
        out.push({ id: 'project.orphans', level: 'project', label: 'orphaned skill links', status: 'warn',
            detail: `${p.orphanLinks.repairable.length} repairable, ${p.orphanLinks.dead.length} dead`,
            remedy: cmd('awm sync') });
    }

    // project.sensors
    out.push(p.sensors.present
        ? { id: 'project.sensors', level: 'project', label: 'sensors', status: 'ok', remedy: none }
        : { id: 'project.sensors', level: 'project', label: 'sensors not initialized', status: 'missing',
            remedy: cmd('awm sensors init') });

    // project.constitution (missing degrada; remedio agente)
    out.push(p.constitution.present
        ? { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md', status: 'ok', remedy: none }
        : { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md missing', status: 'missing',
            remedy: skillRemedy('project-constitution') });

    // project.context (advisory; no degrada)
    if (p.context.present) {
        out.push({ id: 'project.context', level: 'project', label: p.context.file ?? 'CLAUDE.md',
            status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.context', level: 'project', label: 'agent context (CLAUDE.md/AGENTS.md) missing', status: 'warn',
            remedy: skillRemedy('project-context-init') });
    }

    return out;
}

// --- Task 9: overall status for the per-provider diagnostic matrix --------
//
// Kept separate from `overall` above: that one degrades `CheckReport` (the
// machine+project report `init` renders before/after each run) on any
// 'missing' CheckResult. This one degrades the NEW provider matrix
// (doctor-only) on any check state that represents something genuinely
// broken/absent/unsupported — 'pending-trust'/'stale'/'pending' are
// actionable-but-expected transient states (rendered with ◷/⚠, not ✖) and
// do not by themselves degrade `overall`, mirroring how a 'warn' CheckResult
// doesn't degrade the machine+project report either.
// `stale` cuenta como degradado: un contexto desactualizado es exactamente la
// clase de problema que un gate de CI tiene que ver. Antes doctor imprimia ⚠
// junto a `status: healthy` y exit 0, asi que un AGENTS.md viejo — o sobrescrito
// por otro provider — era invisible para cualquier script que mirara el codigo
// de salida. Un aviso que no cambia el veredicto no es un aviso, es ruido.
const DEGRADING_PROVIDER_STATES: ProviderCheckState[] = ['missing', 'unsupported', 'broken', 'absent', 'conflict', 'stale'];

export function computeProviderOverall(providers: ProviderFacts[]): 'healthy' | 'degraded' {
    const degraded = providers.some((p) => p.checks.some((c) => DEGRADING_PROVIDER_STATES.includes(c.state)));
    return degraded ? 'degraded' : 'healthy';
}

export function runChecks(ctx: HarnessContext): CheckReport {
    const results = [
        ...machineChecks(ctx.machine),
        ...(ctx.project ? projectChecks(ctx.project) : []),
    ];
    const overall: CheckReport['overall'] = results.some((r) => r.status === 'missing') ? 'degraded' : 'healthy';
    return {
        results,
        overall,
        hasProject: ctx.project !== null,
        projectName: ctx.project ? path.basename(ctx.project.root) : undefined,
    };
}
