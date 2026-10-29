import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';

export default [
  { ignores: ['node_modules/**', '.cache/**', 'docs/evidence/**', 'test-results/**'] },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } } },
    },
    // Syntax-only rules compatible with TS 7. TypeScript owns type/name checking.
    rules: { 'no-debugger': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error', 'no-unsafe-finally': 'error', 'no-duplicate-case': 'error', 'no-sparse-arrays': 'error' },
  },
];
