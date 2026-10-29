import { contextBridge, ipcRenderer } from 'electron';
import { Channels, type ListSummary, type ListView } from '../shared/ipc.js';

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
  undo(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainUndo) as Promise<string | null>;
  },
  /** Something changed (a capture, an edit, another program): fetch again. */
  onChanged(listener: () => void): void {
    ipcRenderer.on(Channels.mainChanged, () => listener());
  },
};

export type MainBridge = typeof main;

contextBridge.exposeInMainWorld('flintMain', main);
