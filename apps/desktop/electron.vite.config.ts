import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const root = import.meta.dirname;
const core = resolve(root, '../../packages/core/src');

export default defineConfig({
  main: {
    // @flint/core is bundled from source: no build order, no workspace symlink in the installer.
    resolve: {
      alias: [
        { find: /^@flint\/core\/(.+)$/, replacement: `${core}/$1/index.ts` },
        { find: /^@flint\/core$/, replacement: `${core}/index.ts` },
      ],
    },
    build: {
      externalizeDeps: { exclude: ['@flint/core'] },
      rolldownOptions: { input: { index: resolve(root, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      // Sandboxed renderers need self-contained CommonJS preloads (docs/05 §2).
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          popup: resolve(root, 'src/preload/popup.ts'),
          main: resolve(root, 'src/preload/main.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    // The design tokens are imported straight from docs/design (the source of truth, docs/09).
    server: { fs: { allow: [resolve(root, '../..')] } },
    build: {
      rolldownOptions: {
        input: {
          'capture-popup': resolve(root, 'src/renderer/capture-popup/index.html'),
          'main-window': resolve(root, 'src/renderer/main-window/index.html'),
        },
      },
    },
  },
});
