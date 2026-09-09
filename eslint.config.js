import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'build', 'node_modules', 'coverage'] },

  // Renderer (React) — browser globals.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Baseline for an existing codebase: these three account for ~65 of the
      // first-run findings and each needs its own cleanup pass, so they report
      // as warnings rather than blocking. Promote to 'error' once cleared.
      'react-hooks/set-state-in-effect': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused args are common in IPC handlers and event callbacks; allow the
      // conventional _-prefix opt-out rather than forcing noise-only edits.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Main process, build scripts and tests run in Node.
  {
    files: ['electron/**/*.ts', 'tests/**/*.{ts,tsx}', '*.{mjs,cjs,ts}'],
    languageOptions: { globals: globals.node },
  },
);
