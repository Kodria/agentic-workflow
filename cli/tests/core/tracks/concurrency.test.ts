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
    test('devuelve un entero >= 1 (artefacto real o fallback serial)', () => {
        const n = loadDefaultParallelism();
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(1);
    });
});
