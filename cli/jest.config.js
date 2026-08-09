module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // El default de jest son 5s, pensado para tests puros. Esta suite no lo es: 24
  // archivos clonan repos git de verdad, spawnean procesos y consultan si un pid sigue
  // vivo — y en Windows cada una de esas consultas spawnea `tasklist`, cientos de ms
  // bajo carga. Con 5s quedaban justo en el borde: verde varias corridas y timeout la
  // siguiente, sin que cambiara una linea. Paso dos veces en un mismo dia, en
  // `watch/runner` y en `core/profile-pins`, y la segunda publico a npm con la matriz
  // en rojo.
  //
  // Un presupuesto por archivo hubiera sido arreglar 24 sitios y dejar la clase abierta
  // para el proximo test que haga I/O real. Esto la cierra de una vez, incluidos los
  // que todavia no existen. No afloja nada: un test colgado sigue fallando, solo que
  // a los 30s en vez de a los 5. Los archivos que ya declaran su propio presupuesto
  // (60s, 180s) lo conservan — el override por archivo gana.
  testTimeout: 30000,
};
