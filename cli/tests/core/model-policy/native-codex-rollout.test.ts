import fs from 'fs';
import os from 'os';
import path from 'path';
import { readCodexRolloutSelection } from '../../../src/core/model-policy/native-codex-rollout';

describe('Codex local rollout selection reader', () => {
    const expected = { parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'turn-1' };
    const session = { type: 'session_meta', payload: { id: 'child-1', source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1' } } }, cli_version: '0.156.1' } };
    const turn = { timestamp: '2026-09-23T20:00:00.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-6-luna', effort: 'high' } };

    it('reads only an in-scope rollout and returns bounded per-turn metadata', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-home-'));
        const file = path.join(home, 'sessions', 'rollout.jsonl');
        fs.mkdirSync(path.dirname(file));
        fs.writeFileSync(file, `${JSON.stringify(session)}\n${JSON.stringify({ type: 'event_msg', payload: { private: 'do not return' } })}\n${JSON.stringify(turn)}\n`);
        try {
            expect(readCodexRolloutSelection({ codexHome: home, file, expected })).toMatchObject({
                configuredSelection: { selector: { id: 'gpt-6-luna' }, effort: { value: 'high' } }, actualModelVerified: false,
            });
            expect(JSON.stringify(readCodexRolloutSelection({ codexHome: home, file, expected }))).not.toContain('private');
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });

    it('rejects a symlinked rollout and a path outside Codex sessions', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-home-'));
        const outside = path.join(home, 'outside.jsonl');
        const linked = path.join(home, 'sessions', 'linked.jsonl');
        fs.mkdirSync(path.dirname(linked));
        fs.writeFileSync(outside, `${JSON.stringify(session)}\n${JSON.stringify(turn)}\n`);
        fs.symlinkSync(outside, linked);
        try {
            expect(() => readCodexRolloutSelection({ codexHome: home, file: linked, expected })).toThrow(/symlink|unsafe/i);
            expect(() => readCodexRolloutSelection({ codexHome: home, file: outside, expected })).toThrow(/outside|sessions/i);
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });
});
