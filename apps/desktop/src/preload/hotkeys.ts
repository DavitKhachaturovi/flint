import { contextBridge, ipcRenderer } from 'electron';
import { Channels, type HotkeyName, type HotkeysView, type RebindOutcome } from '../shared/ipc.js';

/** The Hotkeys window's only way to the OS (docs/05 §2, APP-08). */
const hotkeys = {
  state(): Promise<HotkeysView> {
    return ipcRenderer.invoke(Channels.hotkeysState) as Promise<HotkeysView>;
  },
  /** While recording, Flint's current hotkeys are switched off so pressing them records them. */
  recording(active: boolean): void {
    ipcRenderer.send(Channels.hotkeysRecording, active);
  },
  rebind(name: HotkeyName, accelerator: string): Promise<RebindOutcome> {
    return ipcRenderer.invoke(Channels.hotkeysRebind, name, accelerator) as Promise<RebindOutcome>;
  },
};

export type HotkeysBridge = typeof hotkeys;

contextBridge.exposeInMainWorld('flintHotkeys', hotkeys);
