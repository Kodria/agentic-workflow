import { buildEvidenceHistory, classifyCure, confidenceForCycles } from '../../../src/core/evidence/history';
import { cycleEvidenceFixture } from '../../helpers/evidence-fixtures';

describe('evidence history', () => {
  it.each([[0, 'none'], [1, 'provisional'], [2, 'observing'], [4, 'observing'], [5, 'supported']] as const)(
    'classifies %i eligible cycles as %s',
    (count, expected) => expect(confidenceForCycles(count)).toBe(expected),
  );

  it.each([
    [0, false, 'awaiting_observation'], [1, false, 'observing'], [2, false, 'observing'],
    [3, false, 'supported'], [1, true, 'recurred'],
  ] as const)('classifies cure observation honestly', (laterEligibleCycles, recurred, expected) => {
    expect(classifyCure({ laterEligibleCycles, recurred })).toBe(expected);
  });

  it('validates every record, retains every eligible row, and sorts stably by timestamp and cycle id', () => {
    const later = { ...cycleEvidenceFixture(), cycleId: 'd'.repeat(64), startedAt: '2026-08-22T11:00:00.000Z', endedAt: '2026-08-22T11:01:00.000Z', cures: [] };
    const sameTimestamp = { ...cycleEvidenceFixture(), cycleId: '0'.repeat(64), cures: [] };
    const history = buildEvidenceHistory([later, cycleEvidenceFixture(), sameTimestamp]);
    expect(history.confidence).toBe('observing');
    expect(history.empty).toBe(false);
    expect(history.cycles.map((cycle) => cycle.cycleId)).toEqual(['0'.repeat(64), 'a'.repeat(64), 'd'.repeat(64)]);
    expect(() => buildEvidenceHistory([{ ...cycleEvidenceFixture(), durationMs: -1 }])).toThrow(/duration/i);
  });

  it('reports zero cycles explicitly without a trend, percentage, or improvement claim', () => {
    const history = buildEvidenceHistory([]);
    expect(history).toEqual(expect.objectContaining({ empty: true, confidence: 'none', cycles: [] }));
    expect(JSON.stringify(history)).not.toMatch(/trend|percentage|improvement/i);
  });

  it('retains blocked records but excludes them from confidence and cure observation windows', () => {
    const blocked = Array.from({ length: 5 }, (_, index) => ({
      ...cycleEvidenceFixture(), cycleId: `${index}`.repeat(64), cycleState: 'blocked' as const, cures: [],
    }));
    const history = buildEvidenceHistory(blocked);
    expect(history.cycles).toHaveLength(5);
    expect(history.confidence).toBe('none');

    const cured = { ...cycleEvidenceFixture(), cycleId: 'c'.repeat(64), endedAt: '2026-08-22T10:01:00.000Z' };
    const laterBlocked = { ...cycleEvidenceFixture(), cycleId: 'd'.repeat(64), cycleState: 'blocked' as const, startedAt: '2026-08-22T11:00:00.000Z', endedAt: '2026-08-22T11:01:00.000Z', cures: [] };
    const laterCompleted = { ...cycleEvidenceFixture(), cycleId: 'e'.repeat(64), startedAt: '2026-08-22T12:00:00.000Z', endedAt: '2026-08-22T12:01:00.000Z', cures: [] };
    const mixed = buildEvidenceHistory([cured, laterBlocked, laterCompleted]);
    expect(mixed.confidence).toBe('observing');
    expect(mixed.cycles[0].cureEfficacy[0].efficacy).toBe('observing');
  });
});
