import { contextBridge, ipcRenderer } from 'electron';
import {
  Channels,
  type PopupFocused,
  type PopupShown,
  type PopupSubmit,
  type PopupSubmitAck,
} from '../shared/ipc.js';

/** The capture popup's only way to the OS (docs/05 §2): the narrow, typed part of Platform it needs. */
const popup = {
  onShown(listener: (shown: PopupShown) => void): void {
    ipcRenderer.on(Channels.popupShown, (_event, shown: PopupShown) => listener(shown));
  },
  reportFocused(sample: PopupFocused): void {
    ipcRenderer.send(Channels.popupFocused, sample);
  },
  submit(capture: PopupSubmit): Promise<PopupSubmitAck> {
    return ipcRenderer.invoke(Channels.popupSubmit, capture) as Promise<PopupSubmitAck>;
  },
  dismiss(): void {
    ipcRenderer.send(Channels.popupDismiss);
  },
};

export type PopupBridge = typeof popup;

contextBridge.exposeInMainWorld('flintPopup', popup);
