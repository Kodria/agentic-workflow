import { spawnStructured, refIsAlive, terminateGroupConfirmed, groupIsGone, activitySnapshot, captureSelfRef } from '../../../src/core/journal/process';

describe('process identity', () => {
    test('spawnStructured produce ProcessRef con tupla completa (R2.1, R4.7)', async () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nonce-abc');
        expect(ref.pid).toBe(child.pid);
        expect(ref.spawnNonce).toBe('nonce-abc');
        expect(typeof ref.startTime).toBe('string');
        expect(ref.processGroup).toBeGreaterThan(0);
        expect(ref.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        expect(refIsAlive(ref)).toBe(true);
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 300, killGraceMs: 300 });
        expect(dead).toBe(true);
        expect(refIsAlive(ref)).toBe(false);
    });

    test('refIsAlive rechaza identidad parcial: startTime O psArgsDigest distintos (R2.1)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n2');
        expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(false);
        expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(false);
        expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
        child.kill('SIGKILL');
    });

    test('terminateGroupConfirmed confirma el GRUPO entero, no solo el lider (R2.1)', async () => {  // verifies R2.1
        // El hijo spawnea un nieto en su mismo grupo; la confirmacion exige pgrep -g vacio.
        const spawnGrandchild = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)']); setTimeout(()=>{}, 5000)";
        const { ref } = spawnStructured(['node', '-e', spawnGrandchild], process.cwd(), 'n3');
        await new Promise((r) => setTimeout(r, 400));      // dejar nacer al nieto
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 2000, killGraceMs: 2000 });
        expect(dead).toBe(true);
        expect(groupIsGone(ref.processGroup)).toBe(true);
    }, 15000);

    test('activitySnapshot reporta cpu y tamanio de grupo de un proceso vivo (soporte R4.2)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n4');
        const snap = activitySnapshot(ref);
        expect(snap).not.toBeNull();
        expect(typeof snap!.cpuTime).toBe('string');
        expect(snap!.groupSize).toBeGreaterThanOrEqual(1);
        child.kill('SIGKILL');
    });

    test('captureSelfRef captura la identidad del proceso actual (R2.1)', () => {  // verifies R2.1
        const self = captureSelfRef('nonce-self');
        expect(self.pid).toBe(process.pid);
        expect(refIsAlive(self)).toBe(true);
    });

    test('refIsAlive nunca declara muerte si ps falla en ejecutarse (no ENOENT como prueba) (R2.1)', () => {  // verifies R2.1
        const cp = require('child_process');
        const self = captureSelfRef('nonce-ps-fail');
        const spy = jest.spyOn(cp, 'execFileSync').mockImplementation(() => {
            const err: any = new Error('spawn ps ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        try {
            expect(refIsAlive(self)).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
});
