// AWM ESLint config — ESLint v8 format (.eslintrc compatible)
// Extends project config with LLM-friendly strict rules
// Usage: npx eslint . --config eslint.config.awm.cjs --format json

module.exports = {
  extends: ['./.eslintrc.js'],
  rules: {
    'no-unused-vars': ['error', { vars: 'all', args: 'after-used' }],
    'no-undef': 'error',
    'no-unreachable': 'error',
  },
};
