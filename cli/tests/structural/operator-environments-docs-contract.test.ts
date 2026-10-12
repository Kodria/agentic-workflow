import fs from 'fs';
import path from 'path';

/**
 * CMD-SCAFFOLD-DOCS — RF-5.2 operator-environments documentation contract.
 * Asserts runbook + cli-reference document scaffold/doctor/env and state that
 * awm-cenco-infra-registry migration is out of scope (RF-5.2).
 */

const repoRoot = path.resolve(__dirname, '../../..');
const runbookPath = path.join(repoRoot, 'docs', 'runbook.md');
const cliReferencePath = path.join(repoRoot, 'docs', 'cli-reference.md');
const designPath = 'docs/plans/2026-10-12-operator-environments-design.md';

function teamRegistriesSection(runbook: string): string {
    const start = runbook.indexOf('## Team registries');
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = runbook.slice(start);
    const nextH2 = rest.search(/\n## (?!Team)/);
    return nextH2 === -1 ? rest : rest.slice(0, nextH2);
}

function registriesSection(cliRef: string): string {
    const start = cliRef.indexOf('## Registries & pinning');
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = cliRef.slice(start);
    const nextH2 = rest.search(/\n## (?!Registries)/);
    return nextH2 === -1 ? rest : rest.slice(0, nextH2);
}

describe('operator-environments docs contract (RF-5.2)', () => {
    it('runbook team-registries leads with scaffold and mentions doctor + design RF-5.2 out-of-scope', () => {
        const runbook = fs.readFileSync(runbookPath, 'utf-8');
        const section = teamRegistriesSection(runbook);

        const scaffoldIdx = section.indexOf('awm registry scaffold');
        const addIdx = section.indexOf('awm registry add');
        expect(scaffoldIdx).toBeGreaterThanOrEqual(0);
        expect(addIdx).toBeGreaterThan(scaffoldIdx);

        expect(section).toContain('awm registry doctor');

        // RF-5.2: Cenco infra registry is out of scope — assert in this section window
        // so a loose mention elsewhere cannot satisfy the contract vacuously.
        expect(section).toMatch(/awm-cenco-infra-registry/);
        expect(section).toMatch(/out of scope|out-of-scope|does not modify|SHALL NOT modify/i);
        expect(section).toMatch(/RF-5\.2/);
        expect(section).toContain(designPath);
    });

    it('cli-reference documents registry scaffold, registry doctor, and awm env', () => {
        const cliRef = fs.readFileSync(cliReferencePath, 'utf-8');
        const registries = registriesSection(cliRef);

        expect(registries).toMatch(/###\s+`awm registry scaffold/);
        expect(registries).toMatch(/###\s+`awm registry doctor/);

        // env lives as its own H2; require the three command strings in the file
        // with scoped checks so headings cannot be satisfied by a stray mention.
        expect(cliRef).toContain('awm registry scaffold');
        expect(cliRef).toContain('awm registry doctor');

        const envStart = cliRef.search(/^##\s+.*\benv\b/im);
        expect(envStart).toBeGreaterThanOrEqual(0);
        const envRest = cliRef.slice(envStart);
        const envNext = envRest.search(/\n## /);
        const envSection = envNext === -1 ? envRest : envRest.slice(0, envNext);
        expect(envSection).toMatch(/awm env/);
        expect(envSection).toMatch(/env set|`awm env set`/i);
        expect(envSection).toMatch(/env status|`awm env status`/i);
    });
});
