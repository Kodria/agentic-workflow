// Huella del entorno de la corrida. Sin hostname ni usuario: la evidencia se
// commitea al repo y la constraint de privacidad del brief prohíbe persistir
// identificadores innecesarios.
import os from 'node:os';

export function fingerprint() {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    date: new Date().toISOString(),
  };
}
