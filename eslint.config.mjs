// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      '.cache/**',
      '.data/**',
      'packages/db/drizzle/**',
      // Service worker bundled by Serwist at build time (source: apps/web/src/sw/sw.ts).
      'apps/web/public/sw.js',
      'apps/web/public/swe-worker-*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // PA-01 / principle 1: the domain is pure. packages/core knows no frameworks, ORM or network.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react',
                'react-dom',
                'drizzle-orm',
                'drizzle-orm/*',
                'mysql2',
                'mysql2/*',
                'hono',
                'hono/*',
                'dexie',
                'ws',
                '@pos/db',
                '@pos/ui',
              ],
              message: 'packages/core is pure domain: no frameworks, ORM, network or UI (PA-01).',
            },
          ],
        },
      ],
    },
  },
  {
    // DEC-021: the order engine is deterministic. Clock readings and new ids come frozen in the
    // operations; the fold never creates them, so every node reaches the same state.
    files: [
      'packages/core/src/orders/{reducer,state,totals,groups}.ts',
      'packages/core/src/tables/state.ts',
      // DEC-029: kitchen tickets are derived from the fold the same way.
      'packages/core/src/kitchen/{tickets,board}.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'The fold never reads the clock: use the operation deviceAt (DEC-021).',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'The fold never reads the clock: use the operation deviceAt (DEC-021).',
        },
        {
          selector: "CallExpression[callee.name='newId']",
          message: 'The fold never creates ids: they come frozen in the payload (DEC-021).',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'The fold is deterministic (DEC-021).',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  prettier,
);
