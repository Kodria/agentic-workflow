---
name: using-awm
version: "1.0.0"
description: Use when starting any development conversation - establishes tiered skill invocation policy (spine skills always, specialized skills on clear signal)
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Instruction Priority

AWM skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **AWM skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

If CLAUDE.md or AGENTS.md says "don't use TDD" and a skill says "always use TDD," follow the user's instructions. The user is in control.

## How to Access Skills

Use the `Skill` tool. When you invoke a skill, its content is loaded and presented to you — follow it directly. **Never use the Read tool on skill files.**

# Using Skills

## La regla (por niveles)

No toda skill compite por tu atención por igual. Aplica dos niveles:

**Espina y gates — considéralas siempre.** Las skills de proceso y de calidad
(`development-process`, `brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `test-driven-development`,
`requesting-code-review`, `receiving-code-review`, `post-implementation-qa`,
`finishing-a-development-branch`, `verification-before-completion`,
`systematic-debugging`) forman la disciplina del desarrollo: evalúalas en todo
trabajo de desarrollo. Tu entrada por defecto es `development-process`.

**Especializadas — solo ante señal clara.** Las demás skills (advisory de
arquitectura/CI/NFR, frontend, documentación, etc.) se invocan **únicamente
cuando el contexto lo pide explícitamente** (hablas de arquitectura, configuras
un pipeline, trabajas una pantalla UI, documentas un módulo…). No las invoques
"por si acaso": esperar la signal evita ruido y carga innecesaria.

## Orchestration

For development tasks, your default entry point is the `development-process` skill — it routes to brainstorming, writing-plans, execution, and finishing based on project state. Invoke it on any new development work unless the user explicitly says otherwise.

For documentation tasks, the equivalent entry point is `docs-system-orchestrator`.

## Red Flags

These thoughts mean STOP — you're rationalizing:

- "I know what to do, I don't need the skill" → **INVOKE IT**
- "It's a simple request, the skill is overkill" → **INVOKE IT**
- "I'll just answer first, then check if a skill applies" → **INVOKE IT FIRST**
- "The skill description doesn't exactly match" → **INVOKE IT if the spine/gates are relevant**
- "The user just asked a question, no skill needed" → **CHECK FIRST for spine skills**

The skill decides if it applies, not you.

## Announcing Skill Use

When you invoke a skill, announce it briefly: *"I'm using the {skill-name} skill to {purpose}."* This makes the process visible to the user and confirms to yourself that you're following the discipline.

## Checklist-Driven Skills

If a skill provides a checklist, create a task for each item with the task tool and complete them in order. Skills are designed to be followed exactly — do not skip steps or reorder them.

## Invariantes de robustez (agnósticos, AWM)

Reglas genéricas que AWM hereda a todo agente vía contexto inyectado. No son específicas de ningún proyecto:

- **Toda función pública valida sus entradas y falla ruidosamente.** Nunca devuelvas `Infinity`/`NaN`/`undefined` en silencio ante entradas inválidas o límite: lanzá un error explícito.
- **El alcance puede excluir *features*, nunca *seguridad/robustez*.** Que el diseño declare algo "fuera de alcance" justifica omitir una feature, no omitir la validación de entradas ni un invariante de robustez. La validación de entradas es un piso, no una feature.
