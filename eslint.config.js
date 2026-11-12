import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      'docs/**',
      'packages/core/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // TypeScript checks undefined names itself (typescript-eslint recommends this).
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'no-undef': 'off' },
  },
  {
    // packages/core must not know it runs in Electron or Node (docs/05 §2).
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'electron/*',
                'node:*',
                'fs',
                'fs/*',
                'path',
                'os',
                'child_process',
              ],
              message:
                'packages/core is pure TypeScript: no Electron or Node imports (docs/05 §2). Pass data or an adapter in instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Plain Node scripts (measurements): Node globals, no type information.
    files: ['**/*.mjs'],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
  },
  {
    // The website's few lines of script (WEB-01): a browser page.
    files: ['site/**/*.js'],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: {
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        performance: 'readonly',
        IntersectionObserver: 'readonly',
      },
    },
  },
  {
    // The site's media renderer (D-184): Node, plus the functions it runs in the browser page.
    files: ['scripts/render-site-media.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        Blob: 'readonly',
        createImageBitmap: 'readonly',
        VideoEncoder: 'readonly',
        VideoFrame: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  prettier,
);
