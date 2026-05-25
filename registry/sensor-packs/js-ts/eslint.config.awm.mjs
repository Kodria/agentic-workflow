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
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
    },
  },
];
