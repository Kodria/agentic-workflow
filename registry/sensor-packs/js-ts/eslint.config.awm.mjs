// AWM ESLint config — extends project config with LLM-friendly messages
// Requires: eslint.config.mjs in the project root (ESLint v9)
// Usage: npx eslint . --config eslint.config.awm.mjs --format json

let projectConfig = [];
try {
  const mod = await import('./eslint.config.mjs');
  projectConfig = Array.isArray(mod.default) ? mod.default : [mod.default];
} catch {
  // no project config — run with AWM rules only
}

export default [
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
];
