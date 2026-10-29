import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const root = import.meta.dirname;
const core = resolve(root, '../../packages/core/src');
// @flint/core is bundled from source: no build order, no workspace symlink in the installer.
const coreAlias = [
  { find: /^@flint\/core\/(.+)$/, replacement: `${core}/$1/index.ts` },
  { find: /^@flint\/core$/, replacement: `${core}/index.ts` },
];

// `--mode bench` builds the R-1 laptop benchmark (docs/06 §1, `npm run dist:bench`).
export default defineConfig(({ mode }) => ({
  main: {
    define: { __FLINT_BENCH_BUILD__: JSON.stringify(mode === 'bench') },
    resolve: { alias: coreAlias },
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
          hotkeys: resolve(root, 'src/preload/hotkeys.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    // The popup parses shorthand itself (CAP-04), from the same core source as the main process.
    resolve: { alias: coreAlias },
    // The design tokens are imported straight from docs/design (the source of truth, docs/09).
    server: { fs: { allow: [resolve(root, '../..')] } },
    build: {
      rolldownOptions: {
        input: {
          'capture-popup': resolve(root, 'src/renderer/capture-popup/index.html'),
          'main-window': resolve(root, 'src/renderer/main-window/index.html'),
          hotkeys: resolve(root, 'src/renderer/hotkeys/index.html'),
        },
      },
    },
  },
}));
