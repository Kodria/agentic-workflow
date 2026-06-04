// src/core/diagnostics/checks.ts
import path from 'path';
import { HarnessContext, MachineFacts, ProjectFacts, CheckResult, CheckReport, Remedy } from './types';

const cmd = (value: string): Remedy => ({ kind: 'command', value });
const skillRemedy = (value: string): Remedy => ({ kind: 'skill', value });
const none: Remedy = { kind: 'none' };

function machineChecks(m: MachineFacts): CheckResult[] {
    const out: CheckResult[] = [];
    const version = m.cliSource.version ?? '?';

    // machine.cli
    if (!m.cliSource.present) {
        out.push({ id: 'machine.cli', level: 'machine', label: 'CLI', status: 'missing',
            detail: 'cache ~/.awm/cli-source ausente', remedy: cmd('awm init') });
    } else if (m.cliSource.gitState === 'clean') {
        out.push({ id: 'machine.cli', level: 'machine', label: `CLI v${version}`, status: 'ok', remedy: none });
    } else if (m.cliSource.gitState === 'behind') {
        out.push({ id: 'machine.cli', level: 'machine', label: `CLI v${version}`, status: 'warn',
            detail: 'cache desactualizado', remedy: cmd('awm update') });
    } else {
        // dirty | unknown | undefined → advisory, sin acción
        out.push({ id: 'machine.cli', level: 'machine', label: `CLI v${version}`, status: 'warn',
            detail: `git ${m.cliSource.gitState ?? 'unknown'}`, remedy: none });
    }

    // machine.hook
    if (m.hook.present && !m.hook.degraded) {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'ok', remedy: none });
    } else if (m.hook.present) {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'warn',
            detail: 'scripts incompletos', remedy: cmd('awm init') });
    } else {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'missing',
            remedy: cmd('awm init') });
    }

    // machine.devCore
    if (m.devCore.present && m.devCore.brokenLinks.length === 0) {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'ok', remedy: none });
    } else if (m.devCore.present) {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'warn',
            detail: `${m.devCore.brokenLinks.length} symlinks rotos`, remedy: cmd('awm init') });
    } else {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'missing',
            remedy: cmd('awm init') });
    }

    // machine.ambient.<b> — una fila por bundle deseado
    for (const b of m.ambient.wanted) {
        const installed = m.ambient.installed.includes(b);
        out.push({ id: `machine.ambient.${b}`, level: 'machine', label: `${b} (ambient)`,
            status: installed ? 'ok' : 'missing', remedy: installed ? none : cmd(`awm add ${b}`) });
    }

    return out;
}

function projectChecks(p: ProjectFacts): CheckResult[] {
    const out: CheckResult[] = [];

    // project.profile
    if (p.profile.present) {
        const exts = p.profile.extensions.length ? p.profile.extensions.join(', ') : 'sin extensiones';
        out.push({ id: 'project.profile', level: 'project', label: `.awm/profile.json (${exts})`,
            status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.profile', level: 'project', label: '.awm/profile.json', status: 'missing',
            remedy: cmd('awm init') });
    }

    // project.activation
    const missingLinks = p.activeBundles.expected.filter((s) => !p.activeBundles.linked.includes(s));
    if (p.activeBundles.broken.length === 0 && missingLinks.length === 0) {
        out.push({ id: 'project.activation', level: 'project', label: 'bundles activos', status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.activation', level: 'project', label: 'bundles activos', status: 'missing',
            detail: `${missingLinks.length} faltan, ${p.activeBundles.broken.length} rotos`, remedy: cmd('awm sync') });
    }

    // project.sensors
    out.push(p.sensors.present
        ? { id: 'project.sensors', level: 'project', label: 'sensores', status: 'ok', remedy: none }
        : { id: 'project.sensors', level: 'project', label: 'sensores no inicializados', status: 'missing',
            remedy: cmd('awm sensors init') });

    // project.constitution (missing degrada; remedio agente)
    out.push(p.constitution.present
        ? { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md', status: 'ok', remedy: none }
        : { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md ausente', status: 'missing',
            remedy: skillRemedy('project-constitution') });

    // project.context (advisory; no degrada)
    if (p.context.present) {
        out.push({ id: 'project.context', level: 'project', label: p.context.file ?? 'CLAUDE.md',
            status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.context', level: 'project', label: 'contexto del agente (CLAUDE.md/AGENTS.md) ausente', status: 'warn',
            remedy: skillRemedy('project-context-init') });
    }

    return out;
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
