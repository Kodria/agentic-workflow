// AWM ESLint config — extends project config with LLM-friendly messages
// Requires: eslint.config.mjs in the project root (ESLint v9)
// Usage: npx eslint . --config eslint.config.awm.mjs --format json

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

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
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // TypeScript resuelve identificadores no definidos en compilacion; sobre
      // .ts esta regla solo produce falsos positivos con tipos y globals.
      'no-undef': 'off',
      // La regla base de eslint no entiende anotaciones de tipo, asi que marca
      // como "arg sin usar" cada nombre de parametro dentro de un TIPO de
      // funcion — `type FingerprintNow = (argv: string[], ...) => ...` daba tres
      // hallazgos. Cuando #171 prendio el gate, esa era la mayoria del backlog:
      // 259 hallazgos con la regla base contra 64 con la regla TS-aware, medido
      // sobre el mismo arbol. Renombrar 200 nombres a `_x` habria empeorado la
      // legibilidad de los tipos para silenciar ruido, asi que el arreglo es la
      // regla correcta, no el renombre. Ahora si es 'error': el resto de los
      // hallazgos son reales y estan limpios.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        vars: 'all', args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_',
        caughtErrors: 'all', caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
