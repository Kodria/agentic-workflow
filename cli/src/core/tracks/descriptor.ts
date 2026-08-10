// Descriptor local de un worktree de track (R2.5): NUNCA versionado, vive
// bajo .awm/ igual que el journal. Es la unica prueba local de pertenencia a
// un plan — el resto de la autenticacion (R2.6) se hace en context.ts contra
// el TrackRef del journal del plan, jamas confiando solo en este archivo.
import fs from 'fs';
import path from 'path';
import { writeFileAtomicDurable } from '../atomic-file';

export interface TrackDescriptor {
    schema: 1;
    planRoot: string;
    planBranch: string;
    trackId: string;
    planJournalId: string;
    fencingToken: string;
}

export const descriptorPath = (trackRoot: string): string => path.join(trackRoot, '.awm', 'track.json');

/** 0600 + escritura durable (mismo contrato que el journal, R1.2): un
 *  descriptor a medio escribir jamas debe autenticar un cwd. */
export function writeDescriptor(trackRoot: string, value: TrackDescriptor): void {
    if (value.schema !== 1 || !path.isAbsolute(value.planRoot) || value.trackId.length === 0
        || value.planJournalId.length === 0 || value.fencingToken.length < 32) {
        throw new Error('descriptor de track inválido');
    }
    fs.mkdirSync(path.dirname(descriptorPath(trackRoot)), { recursive: true, mode: 0o700 });
    writeFileAtomicDurable(descriptorPath(trackRoot), JSON.stringify({ ...value, planRoot: fs.realpathSync(value.planRoot) }, null, 2) + '\n', 0o600);
}

/** null = sin descriptor (modo plan, el caso comun). Forma invalida SIEMPRE
 *  lanza — un descriptor corrupto jamas autentica por omision (R1.6). */
export function readDescriptor(trackRoot: string): TrackDescriptor | null {
    const file = descriptorPath(trackRoot);
    if (!fs.existsSync(file)) return null;
    const x = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (x.schema !== 1 || typeof x.planRoot !== 'string' || typeof x.planBranch !== 'string'
        || typeof x.trackId !== 'string' || typeof x.planJournalId !== 'string'
        || typeof x.fencingToken !== 'string') throw new Error('track.json corrupto');
    return x as unknown as TrackDescriptor;
}
