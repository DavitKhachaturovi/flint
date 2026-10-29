import { contextBridge, ipcRenderer } from 'electron';
import {
  Channels,
  type AttachmentChip,
  type PopupFocused,
  type PopupNoticeAction,
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
  /** CAP-08: the main process keeps the draft in app data. */
  saveDraft(text: string): void {
    ipcRenderer.send(Channels.popupDraft, text);
  },
  /** The popup window follows the card's height, so no invisible area blocks clicks. */
  resize(height: number): void {
    ipcRenderer.send(Channels.popupResize, height);
  },
  /** CAP-06: a pasted image, kept with the draft until the capture is saved. */
  attach(bytes: Uint8Array, type: string): Promise<AttachmentChip | null> {
    return ipcRenderer.invoke(Channels.popupAttach, bytes, type) as Promise<AttachmentChip | null>;
  },
  detach(id: string): void {
    ipcRenderer.send(Channels.popupDetach, id);
  },
  noticeAction(action: PopupNoticeAction): void {
    ipcRenderer.send(Channels.popupNoticeAction, action);
  },
};

export type PopupBridge = typeof popup;

contextBridge.exposeInMainWorld('flintPopup', popup);
