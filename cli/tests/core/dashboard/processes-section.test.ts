import { collectDashboardSnapshot } from '../../../src/core/dashboard/collect';
import type { DashboardSourceAdapters } from '../../../src/core/dashboard/collect';
import fs from 'fs';
import os from 'os';
import path from 'path';

function adapters(processes: DashboardSourceAdapters['processes']): DashboardSourceAdapters {
    return { machine: () => ({ findings: [] }), project: () => ({ findings: [] }), plans: () => [], execution: () => undefined, processes };
}

describe('sección processes del Dashboard', () => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-processes-section-')); fs.writeFileSync(path.join(root, 'package.json'), '{}'); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    function section(a: DashboardSourceAdapters) {
        return collectDashboardSnapshot({ cwd: root, now: '2026-08-23T00:00:00.000Z', adapters: a })
            .sections.find((s) => s.id === 'processes')!;
    }

    it('puebla la sección desde el adapter', () => {                            // verifies R5.3
        const s = section(adapters(() => [{ name: 'mi-proceso', status: 'active' }]));
        expect(s.availability).toBe('available');
        expect(s.items).toEqual([expect.objectContaining({ id: 'process.mi-proceso', label: 'Process', state: 'ok', detail: 'active' })]);
    });

    it('un draft se reporta como attention, no como ok', () => {                // verifies R5.3
        expect(section(adapters(() => [{ name: 'x', status: 'draft' }])).items[0]).toEqual(expect.objectContaining({ state: 'attention', detail: 'draft' }));
    });

    it('sin procesos la sección queda not_applicable, como antes de R1a', () => {  // verifies R5.3
        expect(section(adapters(() => []))).toEqual(expect.objectContaining({ availability: 'not_applicable', items: [] }));
    });

    it('un adapter que lanza degrada a unavailable sin tumbar el snapshot', () => {  // verifies R5.3
        const s = section(adapters(() => { throw new Error('/home/u/secreto boom'); }));
        expect(s.availability).toBe('unavailable');
        expect(JSON.stringify(s)).not.toContain('secreto');
    });

    it('un registry externo no puede inyectar markup ni rutas por el nombre', () => {  // verifies R5.4
        // El nombre ya fue validado como slug por el contrato (Task 1). Este test
        // prueba la SEGUNDA barrera: aunque un adapter mal escrito dejara pasar
        // algo hostil, el sanitizador lo neutraliza antes del render.
        const s = section(adapters(() => [{ name: '<script>/etc/passwd', status: 'active' } as never]));
        const serialized = JSON.stringify(s);
        expect(serialized).not.toContain('<script>');
        expect(serialized).not.toContain('/etc/passwd');
    });
});
