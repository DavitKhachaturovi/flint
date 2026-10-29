import { contextBridge, ipcRenderer } from 'electron';
import { Channels, type DevEvent, type ToastKind } from '../shared/ipc.js';

/**
 * Main window bridge. For now only the development harness for R-1 and R-3 (event log, test toasts);
 * the real main window arrives in M4.
 */
const main = {
  onEvent(listener: (event: DevEvent) => void): void {
    ipcRenderer.on(Channels.devEvent, (_event, devEvent: DevEvent) => listener(devEvent));
  },
  sendTestToast(kind: ToastKind): void {
    ipcRenderer.send(Channels.devSendToast, kind);
  },
};

export type MainBridge = typeof main;

contextBridge.exposeInMainWorld('flintMain', main);
