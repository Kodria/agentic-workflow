import path from 'path';
import fs from 'fs';
import { writeFileAtomicDurable } from '../atomic-file';
import { validateCycleEvidence, type CycleEvidenceV1 } from './types';

export function writeCycleEvidence(root: string, evidence: unknown): CycleEvidenceV1 {
  if (typeof root !== 'string' || root.length === 0) throw new Error('evidence root must be a non-empty string');
  const valid = validateCycleEvidence(evidence);
  const safeRoot = safeDirectory(root, 'root');
  let directory = safeRoot;
  for (const segment of ['.awm', 'evidence', 'cycles']) {
    directory = path.join(directory, segment);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    directory = safeDirectory(directory, `evidence ${segment}`);
  }
  const file = path.join(directory, `${valid.cycleId}.json`);
  writeFileAtomicDurable(file, JSON.stringify(valid, null, 2) + '\n', 0o600);
  return valid;
}

function safeDirectory(directory: string, label: string): string {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe evidence ${label} directory symlink or non-directory`);
  return fs.realpathSync(directory);
}
