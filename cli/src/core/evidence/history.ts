import { validateCycleEvidence, type CycleEvidenceV1 } from './types';

export type EvidenceConfidence = 'none' | 'provisional' | 'observing' | 'supported';
export type CureEfficacy = 'awaiting_observation' | 'observing' | 'supported' | 'recurred';

export interface CureObservationInput { laterEligibleCycles: number; recurred: boolean; }
export interface EvidenceHistoryCycle extends CycleEvidenceV1 {
  retries: number;
  cureEfficacy: Array<{ signature: string; efficacy: CureEfficacy }>;
}
export interface EvidenceHistory { confidence: EvidenceConfidence; empty: boolean; cycles: EvidenceHistoryCycle[]; }

export function confidenceForCycles(count: unknown): EvidenceConfidence {
  if (!Number.isSafeInteger(count) || (count as number) < 0) throw new Error('eligible cycle count must be a non-negative integer');
  const eligibleCycles = count as number;
  if (eligibleCycles === 0) return 'none';
  if (eligibleCycles === 1) return 'provisional';
  if (eligibleCycles < 5) return 'observing';
  return 'supported';
}

export function classifyCure(input: unknown): CureEfficacy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('cure observation must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'laterEligibleCycles' && key !== 'recurred') || !Number.isSafeInteger(value.laterEligibleCycles) || (value.laterEligibleCycles as number) < 0 || typeof value.recurred !== 'boolean') throw new Error('cure observation is invalid');
  const laterEligibleCycles = value.laterEligibleCycles as number;
  if (value.recurred) return 'recurred';
  if (laterEligibleCycles === 0) return 'awaiting_observation';
  return laterEligibleCycles >= 3 ? 'supported' : 'observing';
}

/** Validates, retains, and deterministically orders every eligible local observation. */
export function buildEvidenceHistory(records: unknown): EvidenceHistory {
  if (!Array.isArray(records)) throw new Error('evidence history records must be an array');
  const valid = records.map((record) => validateCycleEvidence(record)).sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.cycleId.localeCompare(right.cycleId));
  const completed = valid.filter((cycle) => cycle.cycleState === 'completed');
  const cycles = valid.map((cycle, index) => ({
    ...cycle,
    retries: cycle.tasks.reduce((total, task) => total + task.retries, 0),
    cureEfficacy: cycle.cures.map((cure) => {
      const later = valid.slice(index + 1).filter((candidate) => candidate.cycleState === 'completed');
      return {
        signature: cure.signature,
        efficacy: classifyCure({ laterEligibleCycles: later.length, recurred: later.some((candidate) => candidate.qa.signatures.includes(cure.signature)) }),
      };
    }),
  }));
  return { confidence: confidenceForCycles(completed.length), empty: cycles.length === 0, cycles };
}
