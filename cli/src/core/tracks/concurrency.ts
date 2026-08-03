// R10.2/R10.3: tope de paralelismo derivado de una medición real (fingerprint
// budget, ver docs/research/r5/benchmark-fingerprint.mjs), nunca de un número
// escrito a mano. Funciones puras/testeables — sin I/O aquí salvo
// loadDefaultParallelism, que es un loader delgado sobre el artefacto
// empaquetado y cae a serial (1) si no lo puede resolver (nunca crashea `awm watch`).
import fs from 'fs';
import path from 'path';

export interface FingerprintBudget {
    cpuCount: number;
    tickMs: number;
    samples: Array<{ supervisors: number; p95Ms: number }>;
}

/** R10.3: el mayor N de supervisores concurrentes cuyo p95 medido no supera
 *  1.5x el baseline serial (N=1) ni el 20% del tick — nunca N=1 si ninguna
 *  medición lo habilita (R10.2, fail-closed hacia serial). */
export function deriveDefaultParallelism(budget: FingerprintBudget): number {
    if (!Number.isInteger(budget.cpuCount) || budget.cpuCount < 1 || budget.samples.length === 0) throw new Error('budget inválido');
    const baseline = budget.samples.find((s) => s.supervisors === 1);
    if (baseline === undefined || baseline.p95Ms <= 0) throw new Error('budget sin baseline N=1');
    return budget.samples
        .filter((s) => Number.isInteger(s.supervisors) && s.supervisors <= budget.cpuCount
            && s.p95Ms <= baseline.p95Ms * 1.5 && s.p95Ms <= budget.tickMs * 0.2)
        .reduce((max, s) => Math.max(max, s.supervisors), 1);
}

/** Parsea `--max-parallel <n>`, mismo estilo de validación que `minutes()` en
 *  watch/index.ts: entero >= 1, fail-closed en cualquier otro caso. */
export function parseMaxParallel(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error('--max-parallel requiere un entero >= 1');
    return n;
}

/** Todos los tracks alcanzan ARMED; solo hasta `maxParallel` (menos los ya
 *  activos) pasan a arrancar. El resto queda `waiting` — el wrapper excedente
 *  espera sin arrancar su loop de watch/fingerprint hasta que un slot libere. */
export function scheduleTracks(tracks: string[], active: Set<string>, maxParallel: number): { start: string[]; waiting: string[] } {
    if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new Error('maxParallel debe ser entero >= 1');
    const capacity = Math.max(0, maxParallel - active.size);
    const candidates = tracks.filter((t) => !active.has(t));
    return { start: candidates.slice(0, capacity), waiting: candidates.slice(capacity) };
}

/** Busca `docs/research/r5/fingerprint-budget.json` subiendo desde este
 *  archivo — funciona igual compilado en dist/ (empaquetado en el npm
 *  package) que corriendo desde src/ en dev/test, sin asumir una profundidad
 *  fija de directorios. */
function findBudgetArtifact(): string | null {
    let dir = __dirname;
    for (let i = 0; i < 8; i += 1) {
        const candidate = path.join(dir, 'docs', 'research', 'r5', 'fingerprint-budget.json');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/** `derivedDefault` del artefacto empaquetado. Si el artefacto no resuelve o
 *  está corrupto, cae a serial (1) — nunca crashea `awm watch` por esto. */
export function loadDefaultParallelism(): number {
    const artifactPath = findBudgetArtifact();
    if (artifactPath === null) return 1;
    try {
        const data = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { derivedDefault?: unknown };
        if (Number.isInteger(data.derivedDefault) && (data.derivedDefault as number) >= 1) return data.derivedDefault as number;
        return 1;
    } catch {
        return 1;
    }
}
