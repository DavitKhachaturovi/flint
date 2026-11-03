import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { LinkPattern } from '../shared/link-patterns.js';
import {
  Channels,
  type AttachFileOutcome,
  type UpNextItem,
  type OpenAttachmentOutcome,
  type ChangeOutcome,
  type EditCommand,
  type ListAction,
  type ListActionOutcome,
  type ListChange,
  type ListSummary,
  type ListView,
  type SidebarAction,
  type SidebarOutcome,
  type SidebarView,
} from '../shared/ipc.js';

/** The main window's only way to the OS (docs/05 §2): its lists, and changing them (M4). */
const main = {
  lists(): Promise<ListSummary[]> {
    return ipcRenderer.invoke(Channels.mainLists) as Promise<ListSummary[]>;
  },
  view(id: string): Promise<ListView | null> {
    return ipcRenderer.invoke(Channels.mainView, id) as Promise<ListView | null>;
  },
  /** Space or the checkbox (TASK-06); resolves to what happened, for the undo toast. */
  toggle(id: string, key: string): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainToggle, id, key) as Promise<string | null>;
  },
  /** The Navigate/Edit keys and the composer (docs/03 §2); null when nothing changed. */
  change(id: string, change: ListChange): Promise<ChangeOutcome | null> {
    return ipcRenderer.invoke(Channels.mainChange, id, change) as Promise<ChangeOutcome | null>;
  },
  /** A task ID for a new row, so the next row can go below it right away. */
  reserveId(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainReserveId) as Promise<string | null>;
  },
  undo(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainUndo) as Promise<string | null>;
  },
  redo(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainRedo) as Promise<string | null>;
  },

  /** D-79: a pasted image saved to the Flint folder's attachments/; its relative link. */
  attach(bytes: Uint8Array, type: string): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainAttach, bytes, type) as Promise<string | null>;
  },
  /** NOTE-02, D-82: Insert ▸ Image: the file picker; the picture's relative link, or null. */
  pickImage(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainPickImage) as Promise<string | null>;
  },
  /** D-84: where a dragged or pasted file is on disk (empty for a picture from the clipboard). */
  pathFor(file: File): string {
    return webUtils.getPathForFile(file);
  },
  /** MEDIA-01, MEDIA-03, D-84: a file added: copied into attachments/, or linked when large. */
  attachFile(path: string): Promise<AttachFileOutcome | null> {
    return ipcRenderer.invoke(Channels.mainAttachFile, path) as Promise<AttachFileOutcome | null>;
  },
  /** MEDIA-03, D-84: Copy into Flint: the linked file copied into attachments/. */
  copyIntoFlint(link: string): Promise<AttachFileOutcome | null> {
    return ipcRenderer.invoke(
      Channels.mainCopyIntoFlint,
      link,
    ) as Promise<AttachFileOutcome | null>;
  },
  attachmentExists(link: string): Promise<boolean> {
    return ipcRenderer.invoke(Channels.mainAttachmentExists, link) as Promise<boolean>;
  },
  /** D-84: in its default app; never a program or script. */
  openAttachment(link: string): Promise<OpenAttachmentOutcome> {
    return ipcRenderer.invoke(Channels.mainOpenAttachment, link) as Promise<OpenAttachmentOutcome>;
  },
  /**
   * MEDIA-02, D-87: a picture (its markdown link, or the `app://` address the viewer shows) copied
   * to the clipboard, shown in its folder, or opened in its default app. False when it isn't there.
   */
  imageAction(source: string, action: 'copy' | 'show' | 'open'): Promise<boolean> {
    return ipcRenderer.invoke(Channels.mainImageAction, source, action) as Promise<boolean>;
  },
  /** TASK-06, D-88: the days after which completed tasks are archived; null when it is off. */
  autoArchive(): Promise<number | null> {
    return ipcRenderer.invoke(Channels.mainAutoArchive) as Promise<number | null>;
  },
  /** TASK-06, D-88: turns auto-archive on (and archives now) or off; how many were archived. */
  setAutoArchive(days: number | null): Promise<number> {
    return ipcRenderer.invoke(Channels.mainSetAutoArchive, days) as Promise<number>;
  },
  /** NAV-07, D-83: the context panel's "Up next" (reminders). */
  upNext(): Promise<readonly UpNextItem[]> {
    return ipcRenderer.invoke(Channels.mainUpNext) as Promise<readonly UpNextItem[]>;
  },
  /** NAV-07, D-83: the panel hidden on this display (Ctrl+\), told on load and on a display change. */
  onPanel(listener: (hidden: boolean) => void): void {
    ipcRenderer.on(Channels.mainPanel, (_event, hidden: boolean) => listener(hidden));
  },
  setPanel(hidden: boolean): void {
    ipcRenderer.send(Channels.mainSetPanel, hidden);
  },
  /** NOTE-06, D-84: a note in monospace or not (this machine). */
  noteMono(id: string, on: boolean): Promise<void> {
    return ipcRenderer.invoke(Channels.mainNoteMono, id, on) as Promise<void>;
  },
  /** NOTE-07, D-84: the user's link patterns, from the settings. */
  linkPatterns(): Promise<readonly LinkPattern[]> {
    return ipcRenderer.invoke(Channels.mainLinkPatterns) as Promise<readonly LinkPattern[]>;
  },
  /** LIST-05, LIST-06: the sidebar's groups and order. */
  sidebar(): Promise<SidebarView | null> {
    return ipcRenderer.invoke(Channels.mainSidebar) as Promise<SidebarView | null>;
  },
  sidebarAction(action: SidebarAction): Promise<SidebarOutcome | null> {
    return ipcRenderer.invoke(Channels.mainSidebarAction, action) as Promise<SidebarOutcome | null>;
  },
  /** LIST-01: new, rename or delete a list or note. */
  listAction(action: ListAction): Promise<ListActionOutcome | null> {
    return ipcRenderer.invoke(Channels.mainListAction, action) as Promise<ListActionOutcome | null>;
  },
  /** D-64: a note's text; resolves to its list ID, which changes when Flint adds its header. */
  saveNote(id: string, text: string): Promise<ListActionOutcome | null> {
    return ipcRenderer.invoke(Channels.mainSaveNote, id, text) as Promise<ListActionOutcome | null>;
  },
  /** A text field's menu (UI-08): Cut / Copy / Paste / Select all. */
  edit(command: EditCommand): void {
    ipcRenderer.send(Channels.editCommand, command);
  },
  /** A link in a title: the main process opens web and mail links in the browser. */
  openLink(href: string): void {
    ipcRenderer.send(Channels.mainOpenLink, href);
  },
  /** Something changed (a capture, an edit, another program): fetch again. */
  onChanged(listener: () => void): void {
    ipcRenderer.on(Channels.mainChanged, () => listener());
  },
  /** A reminder's Open (REM-05): show this task. */
  /** UI-12, D-81: zoom in, out or back to 100 % on this display. */
  zoom(how: 'in' | 'out' | 'reset'): Promise<void> {
    return ipcRenderer.invoke(Channels.mainZoom, how) as Promise<void>;
  },
  /** UI-12, D-81: the interface size changed (Ctrl+= / Ctrl+− / Ctrl+0, or another display). */
  onZoomed(listener: (factor: number) => void): void {
    ipcRenderer.on(Channels.mainZoomed, (_event, factor: number) => listener(factor));
  },
  onReveal(listener: (target: { readonly listId: string; readonly key: string }) => void): void {
    ipcRenderer.on(Channels.mainReveal, (_event, target: { listId: string; key: string }) =>
      listener(target),
    );
  },
};

export type MainBridge = typeof main;

contextBridge.exposeInMainWorld('flintMain', main);
