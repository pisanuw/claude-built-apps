import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.mjs', 'test/**/*.ts', '*.mjs', '*.js', '*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The analytics script runs in the browser as a classic script (apps copy it unchanged).
    files: ['src/analytics/hw-events.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // The theme switch's scripts run in the browser as classic scripts
    // (apps copy them unchanged; theme-init.js is inlined in <head>).
    files: ['src/theme/hw-theme.js', 'src/theme/theme-init.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      // The empty catch is the point: a blocked localStorage falls back to the device setting.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The edge function runs on Deno: Deno globals, fetch and Response are
    // available there; imports use npm: specifiers and .ts extensions.
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, Deno: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // The app template has its own eslint config and is checked from a copy.
  { ignores: ['coverage/**', 'node_modules/**', 'templates/**'] },
);
