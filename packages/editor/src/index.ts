/**
 * Flint's note editor (NOTE-01…10, D-165): CodeMirror 6 with the live preview, tables, conflict
 * cards and the editing commands, shared by the desktop's renderer and the phone's editor web view.
 * DOM only: no Electron, no React Native; what differs between the apps comes through `host.ts`.
 */
export * from './check.js';
export * from './commands.js';
export * from './conflict-view.js';
export * from './copy.js';
export * from './find.js';
export * from './host.js';
export * from './line-endings.js';
export * from './live-preview.js';
export * from './match-flash.js';
export * from './motion.js';
export * from './notices.js';
export * from './preview-checks.js';
export * from './preview.js';
export * from './slash.js';
export * from './syntax.js';
export * from './table-view.js';
export * from './table.js';
export * from './tight-lists.js';
