---
name: using-awm
version: "1.0.0"
description: Use when starting any conversation - establishes how to find and use skills, requiring Skill tool invocation before ANY response including clarifying questions
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill to check.

IF A SKILL APPLIES TO YOUR TASK AFTER CHECKING, YOU DO NOT HAVE A CHOICE. YOU MUST FOLLOW IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## Instruction Priority

AWM skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **AWM skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

If CLAUDE.md or AGENTS.md says "don't use TDD" and a skill says "always use TDD," follow the user's instructions. The user is in control.

## How to Access Skills

Use the `Skill` tool. When you invoke a skill, its content is loaded and presented to you — follow it directly. **Never use the Read tool on skill files.**

# Using Skills

## The Rule

**Invoke relevant or requested skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you should invoke the skill to check. If an invoked skill turns out to be wrong for the situation, you don't need to use it.

## Orchestration

For development tasks, your default entry point is the `development-process` skill — it routes to brainstorming, writing-plans, execution, and finishing based on project state. Invoke it on any new development work unless the user explicitly says otherwise.

For documentation tasks, the equivalent entry point is `docs-system-orchestrator`.

## Red Flags

These thoughts mean STOP — you're rationalizing:

- "I know what to do, I don't need the skill" → **INVOKE IT**
- "It's a simple request, the skill is overkill" → **INVOKE IT**
- "I'll just answer first, then check if a skill applies" → **INVOKE IT FIRST**
- "The skill description doesn't exactly match" → **INVOKE IT IF THERE'S 1% CHANCE**
- "The user just asked a question, no skill needed" → **CHECK FIRST**

The skill decides if it applies, not you.

## Announcing Skill Use

When you invoke a skill, announce it briefly: *"I'm using the {skill-name} skill to {purpose}."* This makes the process visible to the user and confirms to yourself that you're following the discipline.

## Checklist-Driven Skills

If a skill provides a checklist, create a task for each item with the task tool and complete them in order. Skills are designed to be followed exactly — do not skip steps or reorder them.
