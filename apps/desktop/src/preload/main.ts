import { contextBridge, ipcRenderer } from 'electron';
import {
  Channels,
  type ChangeOutcome,
  type ListChange,
  type ListSummary,
  type ListView,
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
  /** A link in a title: the main process opens web and mail links in the browser. */
  openLink(href: string): void {
    ipcRenderer.send(Channels.mainOpenLink, href);
  },
  /** Something changed (a capture, an edit, another program): fetch again. */
  onChanged(listener: () => void): void {
    ipcRenderer.on(Channels.mainChanged, () => listener());
  },
  /** A reminder's Open (REM-05): show this task. */
  onReveal(listener: (target: { readonly listId: string; readonly key: string }) => void): void {
    ipcRenderer.on(Channels.mainReveal, (_event, target: { listId: string; key: string }) =>
      listener(target),
    );
  },
};

export type MainBridge = typeof main;

contextBridge.exposeInMainWorld('flintMain', main);
