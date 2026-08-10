// R5 Task 16 Step 1 — el validador se escribe ANTES de recolectar la evidencia.
//
// Este test es el gate: mientras no exista una corrida REAL por cada provider, falla. Esa
// es su función, no un defecto — "la evidencia faltante nunca se sustituye por
// documentación" (nota de dependencia humana de T16). Un `describe.skip`, un `it.todo` o un
// early-return "si no hay archivos" convertirían el gate en decoración.
//
// **Desvío declarado respecto del plan.** El plan fija los nombres
// `claude-code-sandbox-remote.json` y `codex-owner-mac.json`, hard-codeando el hardware.
// Acá se exige lo que el criterio realmente pide — UNA corrida real por PROVIDER — y se
// enumeran los entornos aceptados por provider. Codex admite `owner-mac` o `vpc-ubuntu`
// porque ambos son máquinas reales fuera de esta sesión; lo que ningún entorno compra es
// saltarse la corrida. La fuerza del gate no cambia: siguen siendo dos providers, dos
// corridas reales, cero filas certificadas por ausencia.
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../docs/research/r5/evidence');

/** Entornos aceptados por provider. Enumerados a propósito: un entorno libre dejaría pasar
 *  `--environment lo-que-sea` y con él una corrida no reproducible. */
const ACCEPTED: Record<string, string[]> = {
    'claude-code': ['sandbox-remote'],
    codex: ['owner-mac', 'vpc-ubuntu'],
};

/** Nombre canónico `<provider>-<environment>.json`. El provider puede llevar guiones
 *  (`claude-code`), así que se resuelve por prefijo conocido y no por el primer `-`. */
function evidenceFor(provider: string): { file: string; environment: string } | null {
    if (!fs.existsSync(root)) return null;
    for (const environment of ACCEPTED[provider]) {
        const file = `${provider}-${environment}.json`;
        if (fs.existsSync(path.join(root, file))) return { file, environment };
    }
    return null;
}

describe('R5 · evidencia de providers reales (R10.4, CA-T.5)', () => {
    test.each(Object.keys(ACCEPTED))('%s tiene UNA corrida real certificada', (provider) => {
        const found = evidenceFor(provider);
        // El mensaje nombra qué falta y cómo producirlo: un rojo sin instrucción se
        // interpreta como test roto y termina borrado.
        expect(found === null ? `FALTA evidencia de ${provider}: correr provider-run.mjs --provider ${provider} --environment <${ACCEPTED[provider].join('|')}> en una máquina real` : found.file)
            .toBe(found?.file);
        if (found === null) throw new Error(`sin evidencia para ${provider} (esperado uno de: ${ACCEPTED[provider].map((e) => `${provider}-${e}.json`).join(', ')})`);

        const x = JSON.parse(fs.readFileSync(path.join(root, found.file), 'utf8'));
        expect(x.schema).toBe(1);
        expect(x.provider).toBe(provider);
        expect(x.environment).toBe(found.environment);
        expect(x.result).toBe('pass');
        expect(x.exercises).toMatchObject({ bootstrap: 'pass', recovery: 'pass', join: 'pass', finalIntegrationRuns: 1 });
        expect(x.sourceHead).toMatch(/^[0-9a-f]{40}$/);
        // La corrida tiene que haber usado el binario construido del repo, no un `awm` del
        // PATH que podría ser cualquier versión publicada.
        expect(x.commands).toEqual(expect.arrayContaining([expect.stringContaining('node dist/src/index.js')]));
        // Los artefactos referenciados existen de verdad: una lista de rutas inventadas
        // certificaría una corrida que nadie puede volver a mirar.
        expect(Array.isArray(x.artifacts) && x.artifacts.length > 0).toBe(true);
        expect(x.artifacts.every((p: string) => fs.existsSync(path.resolve(root, '..', p)))).toBe(true);
        // Sanitización: ni secretos ni rutas de home reales viajan al repo.
        expect(JSON.stringify(x)).not.toMatch(/(?:token|secret|password|\/Users\/[^/]+|\/home\/[^/]+)/i);
    });

    it('la matriz consolidada no declara `supported` sin evidencia', () => {
        const matrix = path.resolve(root, '..', 'provider-matrix.md');
        if (!fs.existsSync(matrix)) throw new Error('falta provider-matrix.md: correr provider-run.mjs --consolidate');
        const text = fs.readFileSync(matrix, 'utf8');
        // La matriz se genera SOLO desde los JSON; si alguno falta, `--consolidate` escribe
        // `not-certified`. Que quede `not-certified` en el archivo es exactamente el estado
        // que este test debe rechazar al cerrar T16.
        expect(text).not.toContain('not-certified');
    });
});
