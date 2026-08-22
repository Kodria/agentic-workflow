import path from 'path';
import { writeFileAtomicDurable } from '../atomic-file';
import { validateCycleEvidence, type CycleEvidenceV1 } from './types';

export function writeCycleEvidence(root: string, evidence: unknown): CycleEvidenceV1 {
  if (typeof root !== 'string' || root.length === 0) throw new Error('evidence root must be a non-empty string');
  const valid = validateCycleEvidence(evidence);
  const file = path.join(root, '.awm', 'evidence', 'cycles', `${valid.cycleId}.json`);
  writeFileAtomicDurable(file, JSON.stringify(valid, null, 2) + '\n', 0o600);
  return valid;
}
