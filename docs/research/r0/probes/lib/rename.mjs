import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function probeRenameReplace(ctx) {
  const src = path.join(ctx.evidenceDir, `.rename-src-${ctx.stamp}`);
  const dst = path.join(ctx.evidenceDir, `.rename-dst-${ctx.stamp}`);
  try {
    const payload = crypto.randomBytes(1024 * 1024); // 1 MiB
    fs.writeFileSync(src, payload);
    fs.writeFileSync(dst, 'contenido viejo que debe desaparecer entero');
    fs.renameSync(src, dst);
    const back = fs.readFileSync(dst);
    const intact = back.length === payload.length && back.equals(payload);
    return {
      state: intact ? 'soportado' : 'degradado',
      detail: intact
        ? 'rename-replace entrega el contenido nuevo íntegro en el fs de evidence/'
        : 'contenido parcial tras rename — NO usar rename como commit atómico aquí',
      artifacts: [],
    };
  } catch (e) {
    return { state: 'no-soportado', detail: `rename falló: ${e.message}`, artifacts: [] };
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(dst, { force: true });
  }
}
