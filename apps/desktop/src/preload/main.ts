import { contextBridge, ipcRenderer } from 'electron';
import {
  Channels,
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
