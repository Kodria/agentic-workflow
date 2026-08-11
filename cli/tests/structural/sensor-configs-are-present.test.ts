// Guard estructural — un sensor declarado cuyo archivo de configuración no existe no es un
// sensor: es un `fail` o un `inconclusive` permanente que entrena a ignorar el rojo.
//
// Pasó dos veces en este repo, y las dos veces sobrevivió meses:
//   - `depcheck` apuntaba a `.dep-cruiser.awm.js`, que NUNCA existió en ninguna rama →
//     `awm sensors run` daba `fail` permanente.
//   - `security` apuntaba a `.semgrep.awm.yml`, que existía en el sensor-pack pero el
//     `.gitignore` del repo (`*.awm.*`) impedía versionarlo → `inconclusive` permanente.
//
// La regla no enumera esos dos: deriva los configs del PROPIO `sensors.json`, así que un
// sensor agregado mañana la hereda sin que nadie se acuerde de este comentario.
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const SENSORS = path.join(CLI_ROOT, '.awm', 'sensors.json');
const BASELINE = path.join(CLI_ROOT, '.awm', 'sensors.baseline.json');

/** Extrae los archivos de config que un comando de sensor referencia. Se buscan por la
 *  convención `*.awm.*` que usan todos los packs, no por una lista de nombres — un pack
 *  nuevo con otro linter queda cubierto igual. */
function configFilesIn(cmd: string): string[] {
    return cmd.split(/\s+/).filter((token) => /\.awm\./.test(token) && !token.startsWith('-'));
}

describe('configs de sensores: declarados <=> presentes', () => {
    const manifest = fs.existsSync(SENSORS)
        ? (JSON.parse(fs.readFileSync(SENSORS, 'utf8')) as { sensors?: Record<string, { cmd?: string; changedCmd?: string }> })
        : null;

    it('el manifiesto de sensores existe y declara sensores', () => {
        expect(manifest?.sensors).toBeDefined();
        expect(Object.keys(manifest!.sensors!).length).toBeGreaterThan(0);
    });

    it('cada archivo de config que un sensor referencia existe en el repo', () => {
        const missing: string[] = [];
        for (const [name, sensor] of Object.entries(manifest?.sensors ?? {})) {
            for (const cmd of [sensor.cmd, sensor.changedCmd].filter((c): c is string => typeof c === 'string')) {
                for (const file of configFilesIn(cmd)) {
                    if (!fs.existsSync(path.join(CLI_ROOT, file))) missing.push(`${name} -> ${file}`);
                }
            }
        }
        // El mensaje nombra sensor y archivo: un rojo que no dice cuál de los dos falta
        // termina resuelto borrando el sensor, que es la salida equivocada.
        expect(missing.join('\n') || 'todos presentes').toBe('todos presentes');
    });

    it('cada sensor conservado en el baseline sigue declarado en el manifiesto', () => {
        const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Record<string, string[]>;
        const missing = Object.keys(baseline).filter((name) => manifest?.sensors?.[name] === undefined);
        expect(missing).toEqual([]);
    });

    it('el sensor de tests cubre la duración observada de la suite con margen de CI', () => {
        const testSensor = manifest?.sensors?.test as { timeout?: number } | undefined;
        expect(testSensor?.timeout).toBeGreaterThanOrEqual(300_000);
    });
});
