/**
 * @flint/core: the parts of Flint that don't depend on Electron (docs/05 §2).
 * Sub-modules are also exported separately (`@flint/core/shorthand`, `@flint/core/time`, …) so the
 * capture popup can load only what it needs (CAP-10).
 */
export * from './format/index.js';
export * from './model/index.js';
export * from './shorthand/index.js';
export * from './time/index.js';
export * from './undo/index.js';
export * from './sync/index.js';
export * from './focus/index.js';
export * from './agents/index.js';
