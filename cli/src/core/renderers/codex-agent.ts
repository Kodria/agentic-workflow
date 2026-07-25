import { parseCanonicalAgent } from './canonical-agent';

function tomlString(value: string): string {
    return JSON.stringify(value);
}

function tomlMultiline(value: string): string {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""');
    return `"""\n${escaped}\n"""`;
}

export function renderCodexAgent(source: string): string {
    const agent = parseCanonicalAgent(source);
    return [
        `name = ${tomlString(agent.name)}`,
        `description = ${tomlString(agent.description)}`,
        `developer_instructions = ${tomlMultiline(agent.instructions)}`,
        '',
    ].join('\n');
}
