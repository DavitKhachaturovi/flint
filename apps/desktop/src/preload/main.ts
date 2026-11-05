import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { LinkPattern } from '../shared/link-patterns.js';
import { applyTestClock } from './test-clock.js';
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
  /** NOTE-02, D-82: Insert ▸ Image: the file picker; the picture's relative link, or null. */
  pickImage(): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainPickImage) as Promise<string | null>;
  },
  /** D-84: where a dragged or pasted file is on disk (empty for a picture from the clipboard). */
  pathFor(file: File): string {
    return webUtils.getPathForFile(file);
  },
  /** MEDIA-01, MEDIA-03, D-84: a file added: copied into attachments/, or linked when large. */
  attachFile(path: string): Promise<AttachFileOutcome | null> {
    return ipcRenderer.invoke(Channels.mainAttachFile, path) as Promise<AttachFileOutcome | null>;
  },
  /** MEDIA-03, D-84: Copy into Flint: the linked file copied into attachments/. */
  copyIntoFlint(link: string): Promise<AttachFileOutcome | null> {
    return ipcRenderer.invoke(
      Channels.mainCopyIntoFlint,
      link,
    ) as Promise<AttachFileOutcome | null>;
  },
  attachmentExists(link: string): Promise<boolean> {
    return ipcRenderer.invoke(Channels.mainAttachmentExists, link) as Promise<boolean>;
  },
  /** D-84: in its default app; never a program or script. */
  openAttachment(link: string): Promise<OpenAttachmentOutcome> {
    return ipcRenderer.invoke(Channels.mainOpenAttachment, link) as Promise<OpenAttachmentOutcome>;
  },
  /**
   * MEDIA-02, D-87: a picture (its markdown link, or the `app://` address the viewer shows) copied
   * to the clipboard, shown in its folder, or opened in its default app. False when it isn't there.
   */
  imageAction(source: string, action: 'copy' | 'show' | 'open'): Promise<boolean> {
    return ipcRenderer.invoke(Channels.mainImageAction, source, action) as Promise<boolean>;
  },
  /** TODAY-02 (M6): Roll over (false) or Clear (true) the unfinished pins; Clear's undo label. */
  todayAnswer(clear: boolean): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainTodayAnswer, clear) as Promise<string | null>;
  },
  /** DATA-02, D-97: the Trash view (deleted, archived). */
  trash(): Promise<TrashView> {
    return ipcRenderer.invoke(Channels.mainTrash) as Promise<TrashView>;
  },
  /** D-97, D-98: Restore from the trash; where it went (the toast's label, its list), or null. */
  restoreFromTrash(id: string): Promise<RestoredItem | null> {
    return ipcRenderer.invoke(Channels.mainTrashRestore, id) as Promise<RestoredItem | null>;
  },
  /** DATA-04, D-97: the snapshots, a snapshot's lists and notes, and restoring (one, or all: null). */
  snapshots(): Promise<SnapshotSummary[]> {
    return ipcRenderer.invoke(Channels.mainSnapshots) as Promise<SnapshotSummary[]>;
  },
  snapshotFiles(id: string): Promise<SnapshotFile[]> {
    return ipcRenderer.invoke(Channels.mainSnapshotFiles, id) as Promise<SnapshotFile[]>;
  },
  restoreSnapshot(id: string, path: string | null): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainSnapshotRestore, id, path) as Promise<string | null>;
  },
  /** APP-11, D-100: Settings. */
  settings(): Promise<SettingsView | null> {
    return ipcRenderer.invoke(Channels.mainSettings) as Promise<SettingsView | null>;
  },
  setSetting(change: SettingChange): Promise<SettingsView | null> {
    return ipcRenderer.invoke(Channels.mainSetSetting, change) as Promise<SettingsView | null>;
  },
  /** DATA-07, D-104: Windows' folder picker for a new Flint folder; null when cancelled. */
  chooseFolder(): Promise<FolderChoice | null> {
    return ipcRenderer.invoke(Channels.mainChooseFolder) as Promise<FolderChoice | null>;
  },
  /** D-104: move to, start fresh in, or open `path`; Flint restarts when it worked. */
  changeFolder(path: string, how: FolderChange): Promise<FolderChangeOutcome | null> {
    return ipcRenderer.invoke(
      Channels.mainChangeFolder,
      path,
      how,
    ) as Promise<FolderChangeOutcome | null>;
  },
  /** NOTE-07, D-104: the link patterns saved; what was kept. */
  saveLinkPatterns(patterns: readonly LinkPattern[]): Promise<readonly LinkPattern[] | null> {
    return ipcRenderer.invoke(Channels.mainSaveLinkPatterns, patterns) as Promise<
      readonly LinkPattern[] | null
    >;
  },
  /** D-105: the built-in link recognizers turned off, and setting them. */
  builtInLinksOff(): Promise<readonly string[]> {
    return ipcRenderer.invoke(Channels.mainBuiltInLinksOff) as Promise<readonly string[]>;
  },
  setBuiltInLinksOff(off: readonly string[]): Promise<readonly string[] | null> {
    return ipcRenderer.invoke(Channels.mainSetBuiltInLinksOff, off) as Promise<
      readonly string[] | null
    >;
  },
  /** D-105: how many places in the lists and notes the pattern would link now. */
  countLinkMatches(pattern: LinkPattern): Promise<number> {
    return ipcRenderer.invoke(Channels.mainCountLinkMatches, pattern) as Promise<number>;
  },
  /** NAV-01, D-106: the palette's search: the lists and notes, or Trash and the archive. */
  search(query: string, scope: 'live' | 'trash'): Promise<readonly SearchHit[]> {
    return ipcRenderer.invoke(Channels.mainSearch, query, scope) as Promise<readonly SearchHit[]>;
  },
  /** APP-03, D-106: Quit Flint (the palette's command). */
  quit(): void {
    ipcRenderer.send(Channels.mainQuit);
  },
  snapshotSpace(): Promise<number> {
    return ipcRenderer.invoke(Channels.mainSnapshotSpace) as Promise<number>;
  },
  clearSnapshots(): Promise<number> {
    return ipcRenderer.invoke(Channels.mainClearSnapshots) as Promise<number>;
  },
  openFolder(which: 'flint' | 'logs'): Promise<void> {
    return ipcRenderer.invoke(Channels.mainOpenFolder, which) as Promise<void>;
  },
  /** APP-08, D-102: the global hotkeys: their state, recording on or off, a new combination. */
  hotkeys(): Promise<HotkeysView | null> {
    return ipcRenderer.invoke(Channels.mainHotkeys) as Promise<HotkeysView | null>;
  },
  recordingHotkey(active: boolean): void {
    ipcRenderer.send(Channels.mainHotkeysRecording, active);
  },
  rebindHotkey(name: HotkeyName, accelerator: string): Promise<RebindOutcome | null> {
    return ipcRenderer.invoke(
      Channels.mainHotkeysRebind,
      name,
      accelerator,
    ) as Promise<RebindOutcome | null>;
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
    return ipcRenderer.invoke(Channels.mainQuickNote) as Promise<string | null>;
  },
  /** NOTE-08, D-99: Keep as a note: a normal note under its time-based name. */
  keepQuickNote(id: string): Promise<ListActionOutcome | null> {
    return ipcRenderer.invoke(Channels.mainKeepQuickNote, id) as Promise<ListActionOutcome | null>;
  },
  discardQuickNote(id: string): Promise<boolean> {
    return ipcRenderer.invoke(Channels.mainDiscardQuickNote, id) as Promise<boolean>;
  },
  /** DATA-05, D-99: Export Flint folder… (a save dialog in the main process). */
  exportFolder(): Promise<void> {
    return ipcRenderer.invoke(Channels.mainExport) as Promise<void>;
  },
  /** D-99: a list's or note's comparison with now, and restoring chosen tasks of it. */
  snapshotDiff(id: string, path: string): Promise<SnapshotDiff | null> {
    return ipcRenderer.invoke(Channels.mainSnapshotDiff, id, path) as Promise<SnapshotDiff | null>;
  },
  restoreSnapshotTasks(id: string, path: string, keys: readonly string[]): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainSnapshotRestoreTasks, id, path, keys) as Promise<
      string | null
    >;
  },
  /** D-97: the tray's Restore from a snapshot…. */
  onShowSnapshots(listener: () => void): void {
    ipcRenderer.on(Channels.mainShowSnapshots, () => listener());
  },
  /** D-98: a trash item opened read-only. */
  trashPreview(id: string): Promise<TrashPreview | null> {
    return ipcRenderer.invoke(Channels.mainTrashPreview, id) as Promise<TrashPreview | null>;
  },
  /** D-97: Delete now, for good. */
  deleteFromTrash(id: string): Promise<boolean> {
    return ipcRenderer.invoke(Channels.mainTrashDelete, id) as Promise<boolean>;
  },
  /** D-97: Empty Trash, for good; how many went. */
  emptyTrash(): Promise<number> {
    return ipcRenderer.invoke(Channels.mainTrashEmpty) as Promise<number>;
  },
  /** TASK-06, D-97: an archived task back in its list; the toast's label, or null. */
  restoreArchived(listId: string, key: string): Promise<string | null> {
    return ipcRenderer.invoke(Channels.mainArchiveRestore, listId, key) as Promise<string | null>;
  },
  /** TASK-06, D-88: the days after which completed tasks are archived; null when it is off. */
  autoArchive(): Promise<number | null> {
    return ipcRenderer.invoke(Channels.mainAutoArchive) as Promise<number | null>;
  },
  /** TASK-06, D-88: turns auto-archive on (and archives now) or off; how many were archived. */
  setAutoArchive(days: number | null): Promise<number> {
    return ipcRenderer.invoke(Channels.mainSetAutoArchive, days) as Promise<number>;
  },
  /** NAV-07, D-83: the context panel's "Up next" (reminders). */
  upNext(): Promise<readonly UpNextItem[]> {
    return ipcRenderer.invoke(Channels.mainUpNext) as Promise<readonly UpNextItem[]>;
  },
  /** NAV-07, D-83: the panel hidden on this display (Ctrl+\), told on load and on a display change. */
  onPanel(listener: (hidden: boolean) => void): void {
    ipcRenderer.on(Channels.mainPanel, (_event, hidden: boolean) => listener(hidden));
  },
  setPanel(hidden: boolean): void {
    ipcRenderer.send(Channels.mainSetPanel, hidden);
  },
  /** NOTE-06, D-84: a note in monospace or not (this machine). */
  noteMono(id: string, on: boolean): Promise<void> {
    return ipcRenderer.invoke(Channels.mainNoteMono, id, on) as Promise<void>;
  },
  /** NOTE-07, D-84: the user's link patterns, from the settings. */
  linkPatterns(): Promise<readonly LinkPattern[]> {
    return ipcRenderer.invoke(Channels.mainLinkPatterns) as Promise<readonly LinkPattern[]>;
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
  /** UI-12, D-81: zoom in, out or back to 100 % on this display; or (D-102) to an exact level. */
  zoom(how: 'in' | 'out' | 'reset' | number): Promise<void> {
    return ipcRenderer.invoke(Channels.mainZoom, how) as Promise<void>;
  },
  /** D-102: the interface size on this display now. */
  zoomLevel(): Promise<number> {
    return ipcRenderer.invoke(Channels.mainZoomLevel) as Promise<number>;
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
};

export type MainBridge = typeof main;

applyTestClock();
contextBridge.exposeInMainWorld('flintMain', main);
