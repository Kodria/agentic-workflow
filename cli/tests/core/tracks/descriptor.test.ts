import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeDescriptor, readDescriptor, descriptorPath, TrackDescriptor } from '../../../src/core/tracks/descriptor';

function descriptor(overrides: Partial<TrackDescriptor> = {}, planRoot: string): TrackDescriptor {
    return {
        schema: 1, planRoot, planBranch: 'main', trackId: 'cli',
        planJournalId: 'j-1', fencingToken: 'f'.repeat(32), ...overrides,
    };
}

describe('descriptor de track (R2.5)', () => {
    let trackRoot: string;
    let planRoot: string;

    beforeEach(() => {
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-desc-track-'));
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-desc-plan-'));
    });

    afterEach(() => {
        fs.rmSync(trackRoot, { recursive: true, force: true });
        fs.rmSync(planRoot, { recursive: true, force: true });
    });

    test('sin descriptor, readDescriptor devuelve null (caso comun)', () => {
        expect(readDescriptor(trackRoot)).toBeNull();
    });

    test('write + read hace roundtrip; planRoot se normaliza a realpath', () => {
        writeDescriptor(trackRoot, descriptor({}, planRoot));
        const out = readDescriptor(trackRoot);
        expect(out).toEqual({
            schema: 1, planRoot: fs.realpathSync(planRoot), planBranch: 'main',
            trackId: 'cli', planJournalId: 'j-1', fencingToken: 'f'.repeat(32),
        });
    });

    test('el archivo se escribe con permisos 0600 (R1.2)', () => {
        writeDescriptor(trackRoot, descriptor({}, planRoot));
        const mode = fs.statSync(descriptorPath(trackRoot)).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    test('rechaza schema distinto de 1', () => {
        expect(() => writeDescriptor(trackRoot, descriptor({ schema: 2 as 1 }, planRoot))).toThrow(/inválido/);
    });

    test('rechaza planRoot relativo', () => {
        expect(() => writeDescriptor(trackRoot, descriptor({}, 'relative/path'))).toThrow(/inválido/);
    });

    test('rechaza trackId vacio', () => {
        expect(() => writeDescriptor(trackRoot, descriptor({ trackId: '' }, planRoot))).toThrow(/inválido/);
    });

    test('rechaza planJournalId vacio', () => {
        expect(() => writeDescriptor(trackRoot, descriptor({ planJournalId: '' }, planRoot))).toThrow(/inválido/);
    });

    test('rechaza fencingToken corto (< 32 chars)', () => {
        expect(() => writeDescriptor(trackRoot, descriptor({ fencingToken: 'short' }, planRoot))).toThrow(/inválido/);
    });

    test('un track.json con forma invalida lanza en vez de autenticar por omision (R1.6)', () => {
        fs.mkdirSync(path.dirname(descriptorPath(trackRoot)), { recursive: true });
        fs.writeFileSync(descriptorPath(trackRoot), JSON.stringify({ schema: 1, planRoot, planBranch: 'main' }));
        expect(() => readDescriptor(trackRoot)).toThrow(/corrupto/);
    });

    test('un track.json con JSON sintacticamente invalido lanza (no crashea silenciosamente en null)', () => {
        fs.mkdirSync(path.dirname(descriptorPath(trackRoot)), { recursive: true });
        fs.writeFileSync(descriptorPath(trackRoot), '{ esto no es json');
        expect(() => readDescriptor(trackRoot)).toThrow();
    });

    test('writeDescriptor es durable: sobrevive a una segunda escritura (idempotente en forma)', () => {
        writeDescriptor(trackRoot, descriptor({}, planRoot));
        writeDescriptor(trackRoot, descriptor({ fencingToken: 'g'.repeat(32) }, planRoot));
        expect(readDescriptor(trackRoot)!.fencingToken).toBe('g'.repeat(32));
    });
});
