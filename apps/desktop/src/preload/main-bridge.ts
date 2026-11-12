import type { SyncAction, SyncEverythingPreview, SyncStatusView } from '../shared/sync.js';
import type {
  AgentChangedEvent,
  AgentsAction,
  AgentsActionOutcome,
  AgentsPausedEvent,
  AgentsSettingsView,
} from '../shared/agents.js';
import { ipcRenderer, webUtils } from 'electron';
import type { LinkPattern } from '../shared/link-patterns.js';
import type { TipId } from '../shared/tips.js';
import type {
  AlarmSound,
  FocusAction,
  FocusCommand,
  FocusSettings,
  FocusTimerView,
} from '../shared/focus.js';
import type { UpdateView } from '../shared/updates.js';
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
  type RestoredItem,
  type Appearance,
  type FolderChange,
  type FolderChangeOutcome,
  type FolderChoice,
  type ClaudeState,
  type GiveToClaudeOutcome,
  type GiveToClaudeRequest,
  type SearchHit,
  type HotkeyName,
  type HotkeysView,
  type RebindOutcome,
  type SettingChange,
  type SettingsView,
  type SnapshotDiff,
  type SnapshotFile,
  type SnapshotSummary,
  type TrashPreview,
  type TrashView,
  type NoteEditorState,
  type OnboardingState,
  type TourAction,
  type TourEvent,
  type ClipboardView,
} from '../shared/ipc.js';

/**
 * D-116: every call waits until main has started. The page loads while main is still reading the
 * Flint folder (slow on the first start after an update), before it can answer; a call made then
 * failed ("no handler") and the page went on without, e.g. the saved link patterns until they were
 * saved again. Main answers `mainStarted` from the start and sends it once everything is set up;
 * calls and messages keep their order. (The capture popup's page loads after its handlers.)
 */
const started = new Promise<void>((resolve) => {
  ipcRenderer.once(Channels.mainStarted, () => resolve());
  void (ipcRenderer.invoke(Channels.mainStarted) as Promise<boolean>).then(
    (yes) => {
      if (yes) resolve();
    },
    () => undefined,
  );
});
/** `ipcRenderer.invoke`, once main can answer. */
export async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  await started;
  return ipcRenderer.invoke(channel, ...args) as Promise<unknown>;
}
/** `ipcRenderer.send`, once main listens. */
export function send(channel: string, ...args: unknown[]): void {
  void started.then(() => ipcRenderer.send(channel, ...args));
}

/** The main window's only way to the OS (docs/05 §2): its lists, and changing them (M4). */
export const main = {
  lists(): Promise<ListSummary[]> {
    return invoke(Channels.mainLists) as Promise<ListSummary[]>;
  },
  view(id: string): Promise<ListView | null> {
    return invoke(Channels.mainView, id) as Promise<ListView | null>;
  },
  /** Space or the checkbox (TASK-06); resolves to what happened, for the undo toast. */
  toggle(id: string, key: string): Promise<string | null> {
    return invoke(Channels.mainToggle, id, key) as Promise<string | null>;
  },
  /** The Navigate/Edit keys and the composer (docs/03 §2); null when nothing changed. */
  change(id: string, change: ListChange): Promise<ChangeOutcome | null> {
    return invoke(Channels.mainChange, id, change) as Promise<ChangeOutcome | null>;
  },
  /** A task ID for a new row, so the next row can go below it right away. */
  reserveId(): Promise<string | null> {
    return invoke(Channels.mainReserveId) as Promise<string | null>;
  },
  undo(): Promise<string | null> {
    return invoke(Channels.mainUndo) as Promise<string | null>;
  },
  redo(): Promise<string | null> {
    return invoke(Channels.mainRedo) as Promise<string | null>;
  },

  /** D-79: a pasted image saved to the Flint folder's attachments/; its relative link. */
  attach(bytes: Uint8Array, type: string): Promise<string | null> {
    return invoke(Channels.mainAttach, bytes, type) as Promise<string | null>;
  },
  /** NOTE-02, D-82: Insert ▸ Image: the file picker; the picture's relative link, or null. */
  pickImage(): Promise<string | null> {
    return invoke(Channels.mainPickImage) as Promise<string | null>;
  },
  /** D-84: where a dragged or pasted file is on disk (empty for a picture from the clipboard). */
  pathFor(file: File): string {
    return webUtils.getPathForFile(file);
  },
  /** MEDIA-01, MEDIA-03, D-84: a file added: copied into attachments/, or linked when large. */
  attachFile(path: string): Promise<AttachFileOutcome | null> {
    return invoke(Channels.mainAttachFile, path) as Promise<AttachFileOutcome | null>;
  },
  /** MEDIA-03, D-84: Copy into Flint: the linked file copied into attachments/. */
  copyIntoFlint(link: string): Promise<AttachFileOutcome | null> {
    return invoke(Channels.mainCopyIntoFlint, link) as Promise<AttachFileOutcome | null>;
  },
  attachmentExists(link: string): Promise<boolean> {
    return invoke(Channels.mainAttachmentExists, link) as Promise<boolean>;
  },
  /** D-84: in its default app; never a program or script. */
  openAttachment(link: string): Promise<OpenAttachmentOutcome> {
    return invoke(Channels.mainOpenAttachment, link) as Promise<OpenAttachmentOutcome>;
  },
  /**
   * MEDIA-02, D-87: a picture (its markdown link, or the `app://` address the viewer shows) copied
   * to the clipboard, shown in its folder, or opened in its default app. False when it isn't there.
   */
  imageAction(source: string, action: 'copy' | 'show' | 'open'): Promise<boolean> {
    return invoke(Channels.mainImageAction, source, action) as Promise<boolean>;
  },
  /** TODAY-02 (M6): Roll over (false) or Clear (true) the unfinished pins; Clear's undo label. */
  todayAnswer(clear: boolean): Promise<string | null> {
    return invoke(Channels.mainTodayAnswer, clear) as Promise<string | null>;
  },
  /** DATA-02, D-97: the Trash view (deleted, archived). */
  trash(): Promise<TrashView> {
    return invoke(Channels.mainTrash) as Promise<TrashView>;
  },
  /** D-97, D-98: Restore from the trash; where it went (the toast's label, its list), or null. */
  restoreFromTrash(id: string): Promise<RestoredItem | null> {
    return invoke(Channels.mainTrashRestore, id) as Promise<RestoredItem | null>;
  },
  /** DATA-04, D-97: the snapshots, a snapshot's lists and notes, and restoring (one, or all: null). */
  snapshots(): Promise<SnapshotSummary[]> {
    return invoke(Channels.mainSnapshots) as Promise<SnapshotSummary[]>;
  },
  snapshotFiles(id: string): Promise<SnapshotFile[]> {
    return invoke(Channels.mainSnapshotFiles, id) as Promise<SnapshotFile[]>;
  },
  restoreSnapshot(id: string, path: string | null): Promise<string | null> {
    return invoke(Channels.mainSnapshotRestore, id, path) as Promise<string | null>;
  },
  /** APP-10, APP-15, D-117: what onboarding shows on this start. */
  onboarding(): Promise<OnboardingState | null> {
    return invoke(Channels.mainOnboarding) as Promise<OnboardingState | null>;
  },
  /** D-119: the walkthrough's progress; `remove` resolves to the undo toast's text. */
  tour(action: TourAction): Promise<string | null> {
    return invoke(Channels.mainTour, action) as Promise<string | null>;
  },
  /** D-117: What's new was shown: this version is the last one seen. */
  whatsNewSeen(): Promise<void> {
    return invoke(Channels.mainWhatsNewSeen) as Promise<void>;
  },
  /** APP-14, D-118: a tip's pattern happened; whether the tip is due now. */
  tipEvent(tip: TipId): Promise<boolean> {
    return invoke(Channels.mainTipEvent, tip) as Promise<boolean>;
  },
  /** The tip was seen (about 3 s on screen, or closed). */
  tipShown(tip: TipId): Promise<void> {
    return invoke(Channels.mainTipShown, tip) as Promise<void>;
  },
  resetTips(): Promise<void> {
    return invoke(Channels.mainResetTips) as Promise<void>;
  },
  /** NAV-08, D-128: Windows' clipboard history (`retry`: read now, also after a crash marker). */
  clipboard(retry = false): Promise<ClipboardView> {
    return invoke(Channels.mainClipboard, retry) as Promise<ClipboardView>;
  },
  /** D-129: Copy: the item becomes the clipboard's content again, as Win+V's pick. */
  clipboardCopy(id: string): Promise<'ok' | 'gone' | 'failed'> {
    return invoke(Channels.mainClipboardCopy, id) as Promise<'ok' | 'gone' | 'failed'>;
  },
  /** D-128: Capture as task: the capture popup, prefilled as by Ctrl+Shift+X. */
  clipboardCapture(id: string): Promise<void> {
    return invoke(Channels.mainClipboardCapture, id) as Promise<void>;
  },
  /** D-129: a picture item whole, as PNG bytes (null: not there any more). */
  clipboardImage(id: string): Promise<Uint8Array | null> {
    return invoke(Channels.mainClipboardImage, id) as Promise<Uint8Array | null>;
  },
  /** D-129: Delete (also from Win+V); the Undo token, or null when it wasn't deleted. */
  clipboardDelete(id: string): Promise<string | null> {
    return invoke(Channels.mainClipboardDelete, id) as Promise<string | null>;
  },
  /** D-129: Undo of a delete: adds the item back as the newest. */
  clipboardRestore(token: string): Promise<boolean> {
    return invoke(Channels.mainClipboardRestore, token) as Promise<boolean>;
  },
  /** D-129: Clear all. */
  clipboardClear(): Promise<boolean> {
    return invoke(Channels.mainClipboardClear) as Promise<boolean>;
  },
  /** D-128: Windows' clipboard settings. */
  clipboardSettings(): Promise<void> {
    return invoke(Channels.mainClipboardSettings) as Promise<void>;
  },
  /** APP-06, D-136: what the updater is doing. */
  updates(): Promise<UpdateView> {
    return invoke(Channels.mainUpdates) as Promise<UpdateView>;
  },
  /** D-136: Check for updates; resolves when the check has started (the view follows). */
  updatesCheck(): Promise<void> {
    return invoke(Channels.mainUpdatesCheck) as Promise<void>;
  },
  /** D-136: install the downloaded update and start again. */
  updatesRestart(): Promise<void> {
    return invoke(Channels.mainUpdatesRestart) as Promise<void>;
  },
  /** D-136: the "Update ready" toast was shown or dismissed. */
  updatesToastSeen(): Promise<void> {
    return invoke(Channels.mainUpdatesToastSeen) as Promise<void>;
  },
  onUpdatesChanged(listener: (view: UpdateView) => void): void {
    ipcRenderer.on(Channels.mainUpdatesChanged, (_event, view: UpdateView) => listener(view));
  },
  /** SYNC-01, D-161: Google Drive sync's status. */
  syncStatus(): Promise<SyncStatusView> {
    return invoke(Channels.mainSync) as Promise<SyncStatusView>;
  },
  syncAct(action: SyncAction): Promise<void> {
    return invoke(Channels.mainSyncAction, action) as Promise<void>;
  },
  syncPreviewEverything(): Promise<SyncEverythingPreview> {
    return invoke(Channels.mainSyncPreview) as Promise<SyncEverythingPreview>;
  },
  onSyncChanged(listener: (view: SyncStatusView) => void): void {
    ipcRenderer.on(Channels.mainSyncChanged, (_event, view: SyncStatusView) => listener(view));
  },
  /** AGENT-05 (D-185): Settings → AI agents. */
  agents(): Promise<AgentsSettingsView | null> {
    return invoke(Channels.mainAgents) as Promise<AgentsSettingsView | null>;
  },
  agentsAct(action: AgentsAction): Promise<AgentsActionOutcome | null> {
    return invoke(Channels.mainAgentsAct, action) as Promise<AgentsActionOutcome | null>;
  },
  onAgentsChanged(listener: () => void): void {
    ipcRenderer.on(Channels.mainAgentsChanged, () => listener());
  },
  /** AGENT-07: an agent changed these; the rows on screen flash once. */
  onAgentChanged(listener: (event: AgentChangedEvent) => void): void {
    ipcRenderer.on(Channels.mainAgentChanged, (_event, changed: AgentChangedEvent) =>
      listener(changed),
    );
  },
  onAgentsPaused(listener: (event: AgentsPausedEvent) => void): void {
    ipcRenderer.on(Channels.mainAgentsPaused, (_event, paused: AgentsPausedEvent) =>
      listener(paused),
    );
  },
  /** The main window came on screen. */
  onShown(listener: () => void): void {
    ipcRenderer.on(Channels.mainShown, () => listener());
  },
  /** APP-14, D-118: the main window was hidden. */
  onHidden(listener: () => void): void {
    ipcRenderer.on(Channels.mainHidden, () => listener());
  },
  /** D-116: something a walkthrough step waits for. */
  onTourEvent(listener: (event: TourEvent) => void): void {
    ipcRenderer.on(Channels.mainTourEvent, (_event, tourEvent: TourEvent) => listener(tourEvent));
  },
  /** APP-11, D-100: Settings. */
  settings(): Promise<SettingsView | null> {
    return invoke(Channels.mainSettings) as Promise<SettingsView | null>;
  },
  setSetting(change: SettingChange): Promise<SettingsView | null> {
    return invoke(Channels.mainSetSetting, change) as Promise<SettingsView | null>;
  },
  /** DATA-07, D-104: Windows' folder picker for a new Flint folder; null when cancelled. */
  chooseFolder(): Promise<FolderChoice | null> {
    return invoke(Channels.mainChooseFolder) as Promise<FolderChoice | null>;
  },
  /** TASK-18, D-151: Give to Claude's folders, and whether Claude is installed. */
  claudeState(): Promise<ClaudeState | null> {
    return invoke(Channels.mainClaudeState) as Promise<ClaudeState | null>;
  },
  /** D-151: Windows' folder picker for Claude, opening at `near`; null when cancelled. */
  chooseClaudeFolder(near: string | null): Promise<string | null> {
    return invoke(Channels.mainClaudeChooseFolder, near) as Promise<string | null>;
  },
  /** D-151: a list's folder for Claude set, or forgotten (null). */
  setClaudeFolder(list: string, folder: string | null): Promise<ClaudeState | null> {
    return invoke(Channels.mainClaudeSetFolder, list, folder) as Promise<ClaudeState | null>;
  },
  clearClaudeRecent(): Promise<ClaudeState | null> {
    return invoke(Channels.mainClaudeClearRecent) as Promise<ClaudeState | null>;
  },
  /** D-151: hands the task to Claude: main builds the claude:// link from the prompt. */
  giveToClaude(request: GiveToClaudeRequest): Promise<GiveToClaudeOutcome | null> {
    return invoke(Channels.mainGiveToClaude, request) as Promise<GiveToClaudeOutcome | null>;
  },
  /** D-104: move to, start fresh in, or open `path`; Flint restarts when it worked. */
  changeFolder(path: string, how: FolderChange): Promise<FolderChangeOutcome | null> {
    return invoke(Channels.mainChangeFolder, path, how) as Promise<FolderChangeOutcome | null>;
  },
  /** NOTE-07, D-104: the link patterns saved; what was kept. */
  saveLinkPatterns(patterns: readonly LinkPattern[]): Promise<readonly LinkPattern[] | null> {
    return invoke(Channels.mainSaveLinkPatterns, patterns) as Promise<
      readonly LinkPattern[] | null
    >;
  },
  /** D-105: the built-in link recognizers turned off, and setting them. */
  builtInLinksOff(): Promise<readonly string[]> {
    return invoke(Channels.mainBuiltInLinksOff) as Promise<readonly string[]>;
  },
  setBuiltInLinksOff(off: readonly string[]): Promise<readonly string[] | null> {
    return invoke(Channels.mainSetBuiltInLinksOff, off) as Promise<readonly string[] | null>;
  },
  /** D-105: how many places in the lists and notes the pattern would link now. */
  countLinkMatches(pattern: LinkPattern): Promise<number> {
    return invoke(Channels.mainCountLinkMatches, pattern) as Promise<number>;
  },
  /** NAV-01, D-106: the palette's search: the lists and notes, or Trash and the archive. */
  search(query: string, scope: 'live' | 'trash'): Promise<readonly SearchHit[]> {
    return invoke(Channels.mainSearch, query, scope) as Promise<readonly SearchHit[]>;
  },
  /** APP-03, D-106: Quit Flint (the palette's command). */
  quit(): void {
    send(Channels.mainQuit);
  },
  snapshotSpace(): Promise<number> {
    return invoke(Channels.mainSnapshotSpace) as Promise<number>;
  },
  clearSnapshots(): Promise<number> {
    return invoke(Channels.mainClearSnapshots) as Promise<number>;
  },
  openFolder(which: 'flint' | 'logs'): Promise<void> {
    return invoke(Channels.mainOpenFolder, which) as Promise<void>;
  },
  /** APP-08, D-102: the global hotkeys: their state, recording on or off, a new combination. */
  hotkeys(): Promise<HotkeysView | null> {
    return invoke(Channels.mainHotkeys) as Promise<HotkeysView | null>;
  },
  recordingHotkey(active: boolean): void {
    send(Channels.mainHotkeysRecording, active);
  },
  rebindHotkey(name: HotkeyName, accelerator: string): Promise<RebindOutcome | null> {
    return invoke(Channels.mainHotkeysRebind, name, accelerator) as Promise<RebindOutcome | null>;
  },
  /** D-100: the tray's Settings. */
  onShowSettings(listener: (section: string | undefined) => void): void {
    ipcRenderer.on(Channels.mainShowSettings, (_event, section: string | undefined) =>
      listener(section),
    );
  },
  /** D-67, D-100: the animation speed (a scale for every duration). */
  onAppearance(listener: (appearance: Appearance) => void): void {
    ipcRenderer.on(Channels.mainAppearance, (_event, appearance: Appearance) =>
      listener(appearance),
    );
  },
  /** NOTE-08, D-99: a new quick note (its ID), and discarding one left empty. */
  quickNote(): Promise<string | null> {
    return invoke(Channels.mainQuickNote) as Promise<string | null>;
  },
  /** NOTE-08, D-99: Keep as a note: a normal note under its time-based name. */
  keepQuickNote(id: string): Promise<ListActionOutcome | null> {
    return invoke(Channels.mainKeepQuickNote, id) as Promise<ListActionOutcome | null>;
  },
  discardQuickNote(id: string): Promise<boolean> {
    return invoke(Channels.mainDiscardQuickNote, id) as Promise<boolean>;
  },
  /** D-131: a quick note opened (again): its removal, if one is waiting, is called off. */
  quickNoteOpened(id: string): void {
    send(Channels.mainQuickNoteOpened, id);
  },
  /** DATA-05, D-99: Export Flint folder… (a save dialog in the main process). */
  exportFolder(): Promise<void> {
    return invoke(Channels.mainExport) as Promise<void>;
  },
  /** D-99: a list's or note's comparison with now, and restoring chosen tasks of it. */
  snapshotDiff(id: string, path: string): Promise<SnapshotDiff | null> {
    return invoke(Channels.mainSnapshotDiff, id, path) as Promise<SnapshotDiff | null>;
  },
  restoreSnapshotTasks(id: string, path: string, keys: readonly string[]): Promise<string | null> {
    return invoke(Channels.mainSnapshotRestoreTasks, id, path, keys) as Promise<string | null>;
  },
  /** D-97: the tray's Restore from a snapshot…. */
  onShowSnapshots(listener: () => void): void {
    ipcRenderer.on(Channels.mainShowSnapshots, () => listener());
  },
  /** D-98: a trash item opened read-only. */
  trashPreview(id: string): Promise<TrashPreview | null> {
    return invoke(Channels.mainTrashPreview, id) as Promise<TrashPreview | null>;
  },
  /** D-97: Delete now, for good. */
  deleteFromTrash(id: string): Promise<boolean> {
    return invoke(Channels.mainTrashDelete, id) as Promise<boolean>;
  },
  /** D-97: Empty Trash, for good; how many went. */
  emptyTrash(): Promise<number> {
    return invoke(Channels.mainTrashEmpty) as Promise<number>;
  },
  /** TASK-06, D-97: an archived task back in its list; the toast's label, or null. */
  restoreArchived(listId: string, key: string): Promise<string | null> {
    return invoke(Channels.mainArchiveRestore, listId, key) as Promise<string | null>;
  },
  /** TASK-06, D-88: the days after which completed tasks are archived; null when it is off. */
  autoArchive(): Promise<number | null> {
    return invoke(Channels.mainAutoArchive) as Promise<number | null>;
  },
  /** TASK-06, D-88: turns auto-archive on (and archives now) or off; how many were archived. */
  setAutoArchive(days: number | null): Promise<number> {
    return invoke(Channels.mainSetAutoArchive, days) as Promise<number>;
  },
  /** NAV-07, D-83: the context panel's "Up next" (reminders). */
  upNext(): Promise<readonly UpNextItem[]> {
    return invoke(Channels.mainUpNext) as Promise<readonly UpNextItem[]>;
  },
  /** NAV-07, D-83: the panel hidden on this display (Ctrl+\), told on load and on a display change. */
  onPanel(listener: (hidden: boolean) => void): void {
    ipcRenderer.on(Channels.mainPanel, (_event, hidden: boolean) => listener(hidden));
  },
  setPanel(hidden: boolean): void {
    send(Channels.mainSetPanel, hidden);
  },
  /** NOTE-06, D-84: a note in monospace or not (this machine). */
  noteMono(id: string, on: boolean): Promise<void> {
    return invoke(Channels.mainNoteMono, id, on) as Promise<void>;
  },
  /** NOTE-09, D-141: a note in Source mode or not (this machine). */
  noteSource(id: string, on: boolean): Promise<void> {
    return invoke(Channels.mainNoteSource, id, on) as Promise<void>;
  },
  /** NOTE-07, D-84: the user's link patterns, from the settings. */
  linkPatterns(): Promise<readonly LinkPattern[]> {
    return invoke(Channels.mainLinkPatterns) as Promise<readonly LinkPattern[]>;
  },
  /** LIST-05, LIST-06: the sidebar's groups and order. */
  sidebar(): Promise<SidebarView | null> {
    return invoke(Channels.mainSidebar) as Promise<SidebarView | null>;
  },
  sidebarAction(action: SidebarAction): Promise<SidebarOutcome | null> {
    return invoke(Channels.mainSidebarAction, action) as Promise<SidebarOutcome | null>;
  },
  /** LIST-01: new, rename or delete a list or note. */
  listAction(action: ListAction): Promise<ListActionOutcome | null> {
    return invoke(Channels.mainListAction, action) as Promise<ListActionOutcome | null>;
  },
  /** D-64: a note's text; resolves to its list ID, which changes when Flint adds its header. */
  saveNote(id: string, text: string): Promise<ListActionOutcome | null> {
    return invoke(Channels.mainSaveNote, id, text) as Promise<ListActionOutcome | null>;
  },
  /** A text field's menu (UI-08): Cut / Copy / Paste / Select all. */
  edit(command: EditCommand): void {
    send(Channels.editCommand, command);
  },
  /** A link in a title: the main process opens web and mail links in the browser. */
  openLink(href: string): void {
    send(Channels.mainOpenLink, href);
  },
  /** Something changed (a capture, an edit, another program): fetch again. */
  onChanged(listener: () => void): void {
    ipcRenderer.on(Channels.mainChanged, () => listener());
  },
  /** A reminder's Open (REM-05): show this task. */
  /** UI-12, D-81: zoom in, out or back to 100 % on this display; or (D-102) to an exact level. */
  zoom(how: 'in' | 'out' | 'reset' | number): Promise<void> {
    return invoke(Channels.mainZoom, how) as Promise<void>;
  },
  /** D-102: the interface size on this display now. */
  zoomLevel(): Promise<number> {
    return invoke(Channels.mainZoomLevel) as Promise<number>;
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
  /** REM-07, D-94: the missed-reminders toast's Open: show Today's Overdue card. */
  onShowOverdue(listener: () => void): void {
    ipcRenderer.on(Channels.mainOverdue, () => listener());
  },
  /** REM-06, D-94: a reminder fired with Flint's own sound on. */
  onChime(listener: () => void): void {
    ipcRenderer.on(Channels.mainChime, () => listener());
  },
  /** MINI-01, D-109: show mini mode, or hide it (the title-bar button, the palette). */
  toggleMini(): void {
    send(Channels.miniToggle);
  },
  /**
   * D-109: one window edits a note at a time. Claiming it asks the other window to save and hand
   * over first; resolves once this window may type.
   */
  claimNote(noteId: string): Promise<boolean> {
    return invoke(Channels.noteClaim, noteId) as Promise<boolean>;
  },
  /** The other window wants the note: save, then say so with `releasedNote`. */
  onReleaseNote(listener: (noteId: string) => void): void {
    ipcRenderer.on(Channels.noteRelease, (_event, noteId: string) => listener(noteId));
  },
  releasedNote(noteId: string, text: string): void {
    send(Channels.noteReleased, noteId, text);
  },
  /** The owner's text as it is typed, for the other window to show. */
  liveNote(noteId: string, text: string): void {
    send(Channels.noteLive, noteId, text);
  },
  onLiveNote(listener: (noteId: string, text: string) => void): void {
    ipcRenderer.on(Channels.noteLive, (_event, noteId: string, text: string) =>
      listener(noteId, text),
    );
  },
  /** This window no longer shows the note (or stopped editing it). */
  leaveNote(noteId: string): void {
    send(Channels.noteLeave, noteId);
  },
  /** Who edits the note now, when it opens. */
  noteEditorOf(noteId: string): Promise<'main' | 'mini' | null> {
    return invoke(Channels.noteEditorOf, noteId) as Promise<'main' | 'mini' | null>;
  },
  onNoteEditor(listener: (state: NoteEditorState) => void): void {
    ipcRenderer.on(Channels.noteEditor, (_event, state: NoteEditorState) => listener(state));
  },
  /** D-107, D-109: whether a first-few-times tip is still due (and counts this showing). */
  tipDue(name: string, times: number): Promise<boolean> {
    return invoke(Channels.tipDue, name, times) as Promise<boolean>;
  },
  /** FOCUS-01 (D-170): the timer and the settings it runs by. */
  focusTimer(): Promise<FocusTimerView | null> {
    return invoke(Channels.focusTimer) as Promise<FocusTimerView | null>;
  },
  /** The timer changed (a command from either window, a session's end, the settings). */
  onFocusTimer(listener: (view: FocusTimerView) => void): void {
    ipcRenderer.on(Channels.focusTimerChanged, (_event, view: FocusTimerView) => listener(view));
  },
  /** Start / Pause, Skip, a mode tab. */
  focusCommand(command: FocusCommand): void {
    send(Channels.focusCommand, command);
  },
  /** Mini's Focus settings…: the main window opens them. */
  showFocusSettings(): void {
    send(Channels.focusCommand, { kind: 'settings' });
  },
  /** FOCUS-02: the Focus page's ⋯ menu; the undo label, or null when nothing changed. */
  focusAction(action: FocusAction): Promise<string | null> {
    return invoke(Channels.focusAction, action) as Promise<string | null>;
  },
  /** FOCUS-05: some of the settings changed; the timer as it is then. */
  setFocusSettings(changes: Partial<FocusSettings>): Promise<FocusTimerView | null> {
    return invoke(Channels.focusSetSettings, changes) as Promise<FocusTimerView | null>;
  },
  /** FOCUS-05: Play in the settings: the sound once, at this volume. */
  playAlarm(sound: AlarmSound, volume: number): void {
    send(Channels.focusAlarm, sound, volume);
  },
  /** FOCUS-04: a session ended (or Play): the alarm, in this window. */
  onFocusAlarm(
    listener: (alarm: { sound: AlarmSound; volume: number; repeat: number }) => void,
  ): void {
    ipcRenderer.on(
      Channels.focusAlarm,
      (_event, alarm: { sound: AlarmSound; volume: number; repeat: number }) => listener(alarm),
    );
  },
  /** A Focus toast's body, mini's Focus settings…: show Focus (`settings`: its settings card). */
  onShowFocus(listener: (settings: boolean) => void): void {
    ipcRenderer.on(Channels.focusShow, (_event, settings: boolean) => listener(settings === true));
  },
};

export type MainBridge = typeof main;
