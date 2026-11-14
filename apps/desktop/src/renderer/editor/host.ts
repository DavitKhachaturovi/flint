/**
 * The desktop's parts of the shared note editor (D-165, packages/editor/src/host.ts): right-click
 * menus, pictures, videos and attachments through Electron, and Copy into Flint. Imported by
 * MarkdownEditor before its first editor.
 */
import { setEditorHost } from '@flint/editor';
import { fileMenuItems, imageMenuItems, mediaElement, onCopyIntoFlint } from '../media/media.js';
import { openMenu } from '../menu/menu.js';

setEditorHost({
  openMenu: (entries, at) => openMenu(entries, at),
  mediaElement,
  imageMenuItems,
  fileMenuItems,
  onCopyIntoFlint,
  copyIntoFlint: (link) => window.flintMain.copyIntoFlint(link),
});
