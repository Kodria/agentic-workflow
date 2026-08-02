import {
    assessDeclaredIndependence, assessActualOwnership, canonicalResource, ownershipPrefix,
} from '../../../src/core/tracks/ownership';

test('sopa de globs soportados: dir/, dir/*, dir/** cubren descendientes (R5.1, R5.4)', () => {
    for (const owner of ['cli/src/', 'cli/src/*', 'cli/src/**']) {
        expect(ownershipPrefix(owner)).toBe('cli/src/');
    }
    expect(ownershipPrefix('cli/src/a.ts')).toBe('cli/src/a.ts');
});

test('un glob intermedio NO habilita paralelismo: falla cerrado (R5.1, R5.3)', () => {
    // Antes esto no colisionaba con nada y dejaba pasar la cohorte entera.
    expect(() => ownershipPrefix('src/**/a.ts')).toThrow(/no soporta este glob/);
    expect(assessDeclaredIndependence([
        track('a', ['src/**/a.ts']), track('b', ['src/lib/a.ts']),
    ])).toMatchObject({ parallel: false });
    expect(assessDeclaredIndependence([track('a', ['src/**/a.ts']), track('b', ['docs/'])]).reasons)
        .toContain('unsupported-glob:src/**/a.ts');
});

test('un glob inexpandible tampoco PRUEBA propiedad post-hoc (R5.8)', () => {
    expect(assessActualOwnership(track('a', ['src/**/a.ts']), [{ status: 'M', path: 'src/lib/a.ts' }]))
        .toMatchObject({ outsideOwnership: ['src/lib/a.ts'] });
});

test('colisiona exacto, case-insensitive y por descendiente (R5.1, R5.3, R5.4)', () => {
    expect(assessDeclaredIndependence([
        track('a', ['src/api/']), track('b', ['SRC/API/user.ts']),
    ])).toMatchObject({ parallel: false, reasons: ['path:SRC/API/user.ts'] });
});

test('rename cuenta path viejo y nuevo (R5.4)', () => {
    const out = assessActualOwnership(track('a', ['src/new.ts']), [
        { status: 'R100', oldPath: 'src/old.ts', path: 'src/new.ts' },
    ]);
    expect(out.outsideOwnership).toEqual(['src/old.ts']);
});

test('un solo lockfile invalida toda la cohorte (R5.7, C5, CA-4.3)', () => {
    expect(assessDeclaredIndependence([
        track('a', ['src/a.ts']), track('b', ['package-lock.json']),
    ])).toMatchObject({ parallel: false, reasons: ['global:lockfile:package-lock.json'] });
});

test('recursos usan clase:valor canónico y colisionan por igualdad (R5.5, R5.6)', () => {
    expect(canonicalResource('port:5432')).toBe('port:5432');
    expect(() => canonicalResource('5432')).toThrow(/<clase>:<valor>/);
    expect(assessDeclaredIndependence([
        track('a', ['a'], ['db:dev']), track('b', ['b'], ['db:dev']),
    ])).toMatchObject({ parallel: false, reasons: ['resource:db:dev'] });
});

test('no afirma observar recursos runtime no declarados (C10)', () => {
    const out = assessDeclaredIndependence([track('a', ['a']), track('b', ['b'])]);
    expect(out).toEqual({ parallel: true, reasons: [] });
    // La garantía es sobre declaraciones + archivos; no existe probe de puertos/bases.
});

test('paths estilo Windows normalizan a posix antes de comparar (R5.3)', () => {
    expect(ownershipPrefix('cli\\src\\')).toBe('cli/src/');
    expect(assessDeclaredIndependence([
        track('a', ['cli\\src\\a.ts']), track('b', ['cli/src/a.ts']),
    ])).toMatchObject({ parallel: false });
    expect(assessActualOwnership(track('a', ['cli/src/']), [{ status: 'M', path: 'cli\\src\\deep\\a.ts' }]))
        .toMatchObject({ outsideOwnership: [] });
});

test('manifest (package.json) es clase global aunque solo un track lo toque (C5)', () => {
    expect(assessDeclaredIndependence([
        track('a', ['src/a.ts']), track('b', ['package.json']),
    ])).toMatchObject({ parallel: false, reasons: ['global:manifest:package.json'] });
    expect(assessActualOwnership(track('a', ['src/a.ts']), [{ status: 'M', path: 'package.json' }]).globalClasses)
        .toEqual(['manifest:package.json']);
});

test('migraciones y snapshots también cuentan como clase global (C5)', () => {
    expect(assessDeclaredIndependence([
        track('a', ['src/a.ts']), track('b', ['migrations/0001_init.sql']),
    ])).toMatchObject({ parallel: false, reasons: ['global:migration:migrations/0001_init.sql'] });
    expect(assessDeclaredIndependence([
        track('a', ['src/a.ts']), track('b', ['__snapshots__/a.snap']),
    ])).toMatchObject({ parallel: false, reasons: ['global:snapshot:__snapshots__/a.snap'] });
});

test('recursos declarados distintos no colisionan; ownership propio no reporta outsideOwnership', () => {
    expect(assessDeclaredIndependence([
        track('a', ['a'], ['db:dev']), track('b', ['b'], ['db:staging']),
    ])).toEqual({ parallel: true, reasons: [] });
    expect(assessActualOwnership(track('a', ['cli/src/']), [{ status: 'M', path: 'cli/src/a.ts' }]))
        .toEqual({ outsideOwnership: [], globalClasses: [] });
});

function track(trackId: string, ownership: string[], sharedResources: string[] = []) {
    return { trackId, taskIds: [trackId], ownership, sharedResources, dependsOn: [] };
}
