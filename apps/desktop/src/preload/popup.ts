import { contextBridge, ipcRenderer } from 'electron';
import {
  Channels,
  type AttachmentChip,
  type CaptureDraft,
  type EditCommand,
  type PopupFocused,
  type PopupNoticeAction,
  type PopupShown,
  type PreviousDraftAction,
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
  saveDraft(draft: CaptureDraft): void {
    ipcRenderer.send(Channels.popupDraft, draft);
  },
  /** D-41: whether the popup holds anything, so clicking elsewhere keeps it open. */
  setContent(hasContent: boolean): void {
    ipcRenderer.send(Channels.popupContent, hasContent);
  },
  /** Shift+Esc (D-39): drop the draft and close. */
  discard(): void {
    ipcRenderer.send(Channels.popupDiscard);
  },
  /** "Previous draft · Restore" (D-39); resolves to what the popup shows next. */
  previous(action: PreviousDraftAction): Promise<Omit<PopupShown, 'hotkeyAt'> | null> {
    return ipcRenderer.invoke(Channels.popupPrevious, action) as Promise<Omit<
      PopupShown,
      'hotkeyAt'
    > | null>;
  },
  /** D-42: clicks reach the popup only over the card; the margin around it lets them through. */
  /** D-47: the card's background drags the popup until the mouse button is released. */
  dragStart(): void {
    ipcRenderer.send(Channels.popupDrag);
  },
  setInteractive(interactive: boolean): void {
    ipcRenderer.send(Channels.popupInteractive, interactive);
  },
  /** The popup window follows the card's height, so no invisible area blocks clicks. */
  /** A text field's menu (UI-08): Cut / Copy / Paste / Select all. */
  edit(command: EditCommand): void {
    ipcRenderer.send(Channels.editCommand, command);
  },
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
