// AWM ESLint config — extends project config with LLM-friendly messages
// Requires: eslint.config.mjs in the project root (ESLint v9)
// Usage: npx eslint . --config eslint.config.awm.mjs --format json

import tsParser from '@typescript-eslint/parser';

let projectConfig = [];
try {
  const mod = await import('./eslint.config.mjs');
  projectConfig = Array.isArray(mod.default) ? mod.default : [mod.default];
} catch {
  // no project config — run with AWM rules only
}

export default [
  // The portable Semgrep fallback lives in a project-local virtualenv. It is
  // runtime tooling, not source owned by this repository.
  { ignores: ['dist/**', '.venv/**', 'venv/**'] },
  {
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
  ...projectConfig,
  {
    rules: {
      // `_`-prefixed args/vars are intentionally unused (callback signatures,
      // interface method types, destructure-and-drop). This is the canonical
      // TS/ESLint convention; without it, type-only param names in interfaces
      // get flagged as unused. See @typescript-eslint/no-unused-vars docs.
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
    },
  },
  // #171: ULTIMO a proposito. Sin un objeto que declare `files` para TypeScript,
  // el universo default de eslint (js/mjs/cjs) deja los .ts fuera del lint y el
  // gate sale verde sin medir una linea del fuente. Y va al final porque en flat
  // config gana el ultimo que matchea: puesto antes, el bloque de reglas generico
  // de arriba le volvia a prender `no-undef` a los .ts (12292 falsos positivos
  // medidos).
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module' } },
    rules: {
      // TypeScript resuelve identificadores no definidos en compilacion; sobre
      // .ts esta regla solo produce falsos positivos con tipos y globals.
      'no-undef': 'off',
      // 'warn', no 'error', SOLO en este paso: prender el gate destapa 263
      // hallazgos reales en 85 archivos que nunca se lintearon (211 args sin
      // usar, 48 vars/imports muertos). Se reportan y se cuentan desde ya; el
      // paso siguiente los limpia y sube esto a 'error'. Un 'error' de entrada
      // dejaria CI en rojo con un diff mecanico de 85 archivos encima del
      // arreglo del gate.
      'no-unused-vars': ['warn', { vars: 'all', args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
