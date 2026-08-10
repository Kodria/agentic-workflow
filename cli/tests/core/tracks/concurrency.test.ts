import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    deriveDefaultParallelism, parseMaxParallel, scheduleTracks, loadDefaultParallelism,
} from '../../../src/core/tracks/concurrency';

describe('deriveDefaultParallelism (R10.3)', () => {
    test('elige el mayor N con p95 <= 1.5x y costo <=20% del tick', () => {
        expect(deriveDefaultParallelism({
            cpuCount: 8, tickMs: 5000,
            samples: [
                { supervisors: 1, p95Ms: 100 }, { supervisors: 2, p95Ms: 130 },
                { supervisors: 3, p95Ms: 149 }, { supervisors: 4, p95Ms: 170 },
            ],
        })).toBe(3);
    });

    test('si ninguna medición habilita N>1 queda serial (R10.2)', () => {
        expect(deriveDefaultParallelism({
            cpuCount: 2, tickMs: 100,
            samples: [{ supervisors: 1, p95Ms: 90 }, { supervisors: 2, p95Ms: 180 }],
        })).toBe(1);
    });

    test('cpuCount:1 acota el tope aunque el costo esté dentro de budget', () => {
        expect(deriveDefaultParallelism({
            cpuCount: 1, tickMs: 5000,
            samples: [{ supervisors: 1, p95Ms: 100 }, { supervisors: 2, p95Ms: 105 }],
        })).toBe(1);
    });

    test('ignora muestras que excedan cpuCount', () => {
        expect(deriveDefaultParallelism({
            cpuCount: 2, tickMs: 5000,
            samples: [
                { supervisors: 1, p95Ms: 100 }, { supervisors: 2, p95Ms: 110 },
                { supervisors: 3, p95Ms: 115 },
            ],
        })).toBe(2);
    });

    test('lanza sobre budget sin baseline N=1', () => {
        expect(() => deriveDefaultParallelism({ cpuCount: 4, tickMs: 5000, samples: [{ supervisors: 2, p95Ms: 10 }] }))
            .toThrow(/baseline/);
    });

    test('lanza sobre budget inválido (cpuCount no entero o sin samples)', () => {
        expect(() => deriveDefaultParallelism({ cpuCount: 0, tickMs: 5000, samples: [{ supervisors: 1, p95Ms: 10 }] }))
            .toThrow(/inválido/);
        expect(() => deriveDefaultParallelism({ cpuCount: 4, tickMs: 5000, samples: [] })).toThrow(/inválido/);
    });
});

describe('parseMaxParallel', () => {
    test('acepta enteros >= 1', () => {
        expect(parseMaxParallel('1')).toBe(1);
        expect(parseMaxParallel('4')).toBe(4);
    });

    test('rechaza 0, negativos, no-enteros y no-numéricos', () => {
        expect(() => parseMaxParallel('0')).toThrow(/entero >= 1/);
        expect(() => parseMaxParallel('-1')).toThrow(/entero >= 1/);
        expect(() => parseMaxParallel('1.5')).toThrow(/entero >= 1/);
        expect(() => parseMaxParallel('abc')).toThrow(/entero >= 1/);
    });
});

describe('scheduleTracks', () => {
    test('arranca hasta la capacidad libre, el resto espera', () => {
        expect(scheduleTracks(['a', 'b', 'c'], new Set(['a']), 2)).toEqual({ start: ['b'], waiting: ['c'] });
    });

    test('sin capacidad libre todos quedan waiting', () => {
        expect(scheduleTracks(['a', 'b', 'c'], new Set(['a', 'b']), 2)).toEqual({ start: [], waiting: ['c'] });
    });

    test('capacidad de sobra arranca todos los candidatos', () => {
        expect(scheduleTracks(['a', 'b', 'c'], new Set(), 5)).toEqual({ start: ['a', 'b', 'c'], waiting: [] });
    });

    test('rechaza maxParallel invalido', () => {
        expect(() => scheduleTracks(['a'], new Set(), 0)).toThrow(/entero >= 1/);
    });
});

describe('loadDefaultParallelism', () => {
    // startDir es un tmpdir aislado en cada test — nunca toca ~/.awm ni depende
    // del árbol real del repo (patrón de tmpdirs aislados de este repo, ver
    // cli/tests/core/tracks/context.test.ts).
    let tmp: string;
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-concurrency-load-'));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function artifactPathUnder(dir: string): string {
        return path.join(dir, 'docs', 'research', 'r5', 'fingerprint-budget.json');
    }

    test('artefacto ausente en todo el árbol de directorios -> serial (1)', () => {
        expect(loadDefaultParallelism(tmp)).toBe(1);
    });

    test('artefacto con JSON inválido/corrupto -> serial (1)', () => {
        const p = artifactPathUnder(tmp);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, '{ esto no es json');
        expect(loadDefaultParallelism(tmp)).toBe(1);
    });

    test('derivedDefault ausente -> serial (1)', () => {
        const p = artifactPathUnder(tmp);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({ cpuCount: 4, tickMs: 5000, samples: [] }));
        expect(loadDefaultParallelism(tmp)).toBe(1);
    });

    test('derivedDefault no entero -> serial (1)', () => {
        const p = artifactPathUnder(tmp);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({ derivedDefault: 2.5 }));
        expect(loadDefaultParallelism(tmp)).toBe(1);
    });

    test('derivedDefault fuera de rango (< 1) -> serial (1)', () => {
        const p = artifactPathUnder(tmp);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({ derivedDefault: 0 }));
        expect(loadDefaultParallelism(tmp)).toBe(1);
    });

    test('artefacto válido -> devuelve el derivedDefault real, buscando hacia arriba desde un subdirectorio', () => {
        const p = artifactPathUnder(tmp);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({
            sourceHead: 'a'.repeat(40), node: process.version, platform: process.platform,
            cpuCount: 4, tickMs: 5000, samples: [{ supervisors: 1, p50Ms: 10, p95Ms: 12 }], derivedDefault: 3,
        }));
        const nested = path.join(tmp, 'cli', 'dist', 'src', 'core', 'tracks');
        fs.mkdirSync(nested, { recursive: true });
        expect(loadDefaultParallelism(nested)).toBe(3);
    });

    test('sin override, resuelve desde __dirname del propio módulo (integración real)', () => {
        const n = loadDefaultParallelism();
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
    });
});
