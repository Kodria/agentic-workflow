export type Polarity = 'win' | 'finding';
export type LedgerClass = 'structural' | 'logica' | 'proceso' | 'seguridad';
export type Severity = 'blocker' | 'important' | 'minor' | 'info';

export interface LedgerEntry {
    ts: string;
    branch: string;
    phase: string;
    source_skill: string;
    polarity: Polarity;
    class: LedgerClass;
    signature: string;
    severity: Severity;
    desc: string;
    ref?: string;
}
