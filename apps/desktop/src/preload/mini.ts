import { contextBridge, ipcRenderer } from 'electron';
import {
  Channels,
  type MiniAlert,
  type MiniAlertAction,
  type MiniCapture,
  type MiniEdgeState,
  type MiniLayout,
  type MiniResize,
  type MiniState,
  type MiniSurface,
  type MiniTabMove,
} from '../shared/ipc.js';
import { invoke, main, send } from './main-bridge.js';
import { applyTestClock } from './test-clock.js';

/**
 * MINI-01, D-109: mini mode's only way to the OS (docs/05 §2). The narrow part of the main
 * window's Platform it needs, under the same name (the shared note editor reaches it there): its
 * lists and tasks, the quick notes, undo, the editor's images and text-field menu, the note
 * ownership and tips. Plus `flintMini`: its own window, its tab and the reminder cards.
 */
const MINI_PLATFORM = [
  'lists',
  'view',
  'toggle',
  'change',
  'undo',
  'redo',
  'saveNote',
  'noteSource',
  'quickNote',
  'keepQuickNote',
  'discardQuickNote',
  'quickNoteOpened',
  'listAction',
  'linkPatterns',
  'builtInLinksOff',
  'edit',
  'openLink',
  'onChanged',
  'pickImage',
  'pathFor',
  'attach',
  'attachFile',
  'copyIntoFlint',
  'imageAction',
  'openAttachment',
  'attachmentExists',
  'claimNote',
  'onReleaseNote',
  'releasedNote',
  'liveNote',
  'onLiveNote',
  'leaveNote',
  'onNoteEditor',
  'noteEditorOf',
  'tipDue',
  'settings',
  'onAppearance',
  // FOCUS-06 (D-170): Focus's timer in mini's Focus tab.
  'focusTimer',
  'onFocusTimer',
  'focusCommand',
  'showFocusSettings',
] as const satisfies readonly (keyof typeof main)[];

export type MiniPlatform = Pick<typeof main, (typeof MINI_PLATFORM)[number]>;

// The bridge's methods never use `this` (each is a plain IPC call).
const platform = Object.fromEntries(
  // eslint-disable-next-line @typescript-eslint/unbound-method -- see above
  MINI_PLATFORM.map((name) => [name, main[name]]),
) as unknown as MiniPlatform;

const mini = {
  /** × (and the hotkey's second press): hidden, to the tray; it stays alive. */
  hide(): void {
    send(Channels.miniHide);
  },
  state(): Promise<MiniState> {
    return invoke(Channels.miniState) as Promise<MiniState>;
  },
  setState(state: Partial<Pick<MiniState, 'tab' | 'listId' | 'noteId'>>): void {
    send(Channels.miniSetState, state);
  },
  /** The header's pin: always on top, or not. */
  setOnTop(onTop: boolean): Promise<boolean> {
    return invoke(Channels.miniSetOnTop, onTop) as Promise<boolean>;
  },
  /** Shown; `focus` when Davit opened it (not when a reminder did). */
  onShown(listener: (shown: { readonly focus: boolean }) => void): void {
    ipcRenderer.on(Channels.miniShown, (_event, shown: { focus: boolean }) => listener(shown));
  },
  /** About to be hidden: a quick note being left; the card fades out (D-111). */
  onHiding(listener: () => void): void {
    ipcRenderer.on(Channels.miniHiding, () => listener());
  },
  /** D-111: hidden now: the card waits, ready to rise in when shown. */
  onHidden(listener: () => void): void {
    ipcRenderer.on(Channels.miniHidden, () => listener());
  },
  /** Open, double-click or Enter: the main window at this place (mini stays). */
  open(place: { readonly listId: string; readonly key?: string }): void {
    send(Channels.miniOpen, place);
  },
  /** REM-06, D-109: the reminder cards waiting, and acting on one (the toast goes too). */
  alerts(): Promise<readonly MiniAlert[]> {
    return invoke(Channels.miniGetAlerts) as Promise<readonly MiniAlert[]>;
  },
  onAlerts(listener: (alerts: readonly MiniAlert[]) => void): void {
    ipcRenderer.on(Channels.miniAlerts, (_event, alerts: readonly MiniAlert[]) => listener(alerts));
  },
  alertAction(id: string, action: MiniAlertAction): void {
    send(Channels.miniAlertAction, id, action);
  },
  /** MINI-02, D-157: a selection captured into the note waits (also sent as the page starts). */
  onCapture(listener: () => void): void {
    ipcRenderer.on(Channels.miniCapture, () => listener());
  },
  /** The captures waiting, in order; taken, so none is added twice. */
  takeCaptures(): Promise<readonly MiniCapture[]> {
    return invoke(Channels.miniTakeCaptures) as Promise<readonly MiniCapture[]>;
  },
  /** D-110: where the card sits in the transparent window, and how big it may be. */
  onLayout(listener: (layout: MiniLayout) => void): void {
    ipcRenderer.on(Channels.miniLayout, (_event, layout: MiniLayout) => listener(layout));
  },
  /** The layout now (the page asks when it starts, in case it missed the message). */
  layout(): Promise<MiniLayout | null> {
    return invoke(Channels.miniGetLayout) as Promise<MiniLayout | null>;
  },
  /** Snapping into another corner: the card is hidden, the window may move. */
  layoutReady(id: number): void {
    send(Channels.miniLayoutReady, id);
  },
  /** The window has moved into the corner: the card settles in. */
  onSettled(listener: (id: number) => void): void {
    ipcRenderer.on(Channels.miniSettled, (_event, id: number) => listener(id));
  },
  /** The card's size and where clicks reach the page (elsewhere they pass through). */
  surface(surface: MiniSurface): void {
    send(Channels.miniSurface, surface);
  },
  /** A resize let go: its width and height limit, remembered. */
  resized(size: MiniResize): void {
    send(Channels.miniResized, size);
  },
  /** MINI-04, D-177: at the screen's edge now (the page asks when it starts), and what changes. */
  edge(): Promise<MiniEdgeState | null> {
    return invoke(Channels.miniGetEdge) as Promise<MiniEdgeState | null>;
  },
  onEdge(listener: (state: MiniEdgeState) => void): void {
    ipcRenderer.on(Channels.miniEdge, (_event, state: MiniEdgeState) => listener(state));
  },
  /** The tab clicked (open), the header's Collapse or Ctrl+M (collapse). */
  edgeAction(action: 'open' | 'collapse'): void {
    send(Channels.miniEdgeAction, action);
  },
  /** The tab dragged across to the other edge, or let go. */
  tabMoved(move: MiniTabMove): void {
    send(Channels.miniTabMoved, move);
  },
};

export type MiniBridge = typeof mini;

applyTestClock();
contextBridge.exposeInMainWorld('flintMain', platform);
contextBridge.exposeInMainWorld('flintMini', mini);
