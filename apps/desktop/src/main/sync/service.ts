/**
 * Google Drive sync in the running app (SYNC-01, D-161, docs/05 §5): signs in, runs the engine
 * 5 s after a change, every 3 minutes, on waking and when the network is back, and on Sync now;
 * one run at a time; reports its status to the windows. Local data is never changed by a problem.
 */
import {
  SyncEngine,
  countConflicts,
  emptyState,
  type Drive,
  type LocalSide,
  type SyncReport,
  type SyncState,
} from '@flint/core/sync';
import type {
  SyncAction,
  SyncConflict,
  SyncEverythingPreview,
  SyncPhase,
  SyncProblem,
  SyncStatusView,
} from '../../shared/sync.js';
import type { SyncStore } from './store.js';

export const AFTER_CHANGE_MS = 5_000;
export const EVERY_MS = 3 * 60_000;

/** Sign-in and Drive, real or (in test runs) the fake. */
export interface SyncConnection {
  /** Whether this build can sync at all (a Google client ID, docs/06 §6). */
  readonly available: boolean;
  /** Opens the sign-in; resolves with the account's address and refresh token. */
  signIn(): { readonly result: Promise<{ email: string; refreshToken: string }>; cancel(): void };
  /** The Drive for a signed-in account. */
  drive(refreshToken: string): Drive;
  /** Disconnect: Google forgets Flint's access (best effort). */
  revoke(refreshToken: string): Promise<void>;
  /** Opens a link in the browser (Open in Drive, Restore it in Drive). */
  open(url: string): void;
  folderUrl(id: string): string;
  fileUrl(id: string): string;
  readonly trashUrl: string;
}

export interface SyncServiceOptions {
  readonly store: SyncStore;
  readonly connection: SyncConnection;
  readonly local: LocalSide;
  /** `Flint` (installed) or `Flint (development)` (D-161 Q7). */
  readonly folderName: string;
  /** Lists, notes and groups on this PC, for counts and group membership. */
  readonly items: () => Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly mode: 'tasks' | 'note';
      readonly group: string | null;
    }[]
  >;
  readonly groups: () => Promise<
    readonly { readonly id: string; readonly lists: readonly string[] }[]
  >;
  readonly log: (message: string) => void;
  /** Called whenever the status changes (main sends it to the windows). */
  readonly onStatus: (status: SyncStatusView) => void;
  /** The browser sign-in ended (done or failed): Flint comes back to the front. */
  readonly onSignInEnded?: () => void;
}

export class SyncService {
  private readonly options: SyncServiceOptions;
  private state: SyncState = emptyState();
  private account: { email: string; refreshToken: string } | null = null;
  private engine: SyncEngine | null = null;
  private phase: SyncPhase = 'disconnected';
  private problem: SyncProblem | null = null;
  private lastReport: SyncReport | null = null;
  private conflicts: SyncConflict[] = [];
  private signing: { cancel(): void } | null = null;
  /** Why the last sign-in failed, for Settings → Sync (cleared by the next try). */
  private connectError: string | null = null;
  private running: Promise<void> | null = null;
  private queued = false;
  private changeTimer: NodeJS.Timeout | undefined;
  private everyTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryDelay = 2_000;
  private stopped = false;

  constructor(options: SyncServiceOptions) {
    this.options = options;
  }

  /** Loads the account and state; starts syncing when connected. */
  async start(): Promise<void> {
    if (!this.options.connection.available) {
      this.phase = 'unavailable';
      this.emit();
      return;
    }
    this.state = await this.options.store.readState();
    this.account = await this.options.store.readAccount();
    if (!this.account) {
      this.phase = 'disconnected';
      this.emit();
      return;
    }
    this.makeEngine();
    this.phase = this.state.mode === null ? 'setup' : 'synced';
    this.emit();
    this.schedule();
    if (this.state.mode !== null) void this.request();
  }

  /** Whether sync's session may reach Google now (docs/05 §5): connected, or signing in. */
  networkAllowed(): boolean {
    return this.account !== null || this.phase === 'signing-in';
  }

  private makeEngine(): void {
    if (!this.account) return;
    this.engine = new SyncEngine({
      drive: this.options.connection.drive(this.account.refreshToken),
      local: this.options.local,
      bases: this.options.store.bases,
      state: this.state,
      folderName: this.options.folderName,
    });
  }

  private schedule(): void {
    clearInterval(this.everyTimer);
    this.everyTimer = setInterval(() => void this.request(), EVERY_MS);
    this.everyTimer.unref?.();
  }

  /** The Flint folder changed (Workspace.onChange): sync 5 s after the last change. */
  changed(): void {
    if (!this.engine || this.state.mode === null) return;
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => void this.request(), AFTER_CHANGE_MS);
    this.changeTimer.unref?.();
  }

  /** Woken from sleep, or back online: now. */
  wake(): void {
    if (this.phase === 'offline' || this.phase === 'synced' || this.phase === 'attention')
      void this.request();
  }

  /** Asks for a run; one runs at a time, and one more queues behind it. */
  request(): Promise<void> {
    if (!this.engine || this.state.mode === null || this.stopped) return Promise.resolve();
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.runOnce().finally(() => {
      this.running = null;
      if (this.queued) {
        this.queued = false;
        void this.request();
      }
    });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    clearTimeout(this.retryTimer);
    this.phase = 'syncing';
    this.emit();
    const report = await engine.run();
    this.lastReport = report;
    await this.options.store
      .writeState(this.state)
      .catch((error: unknown) => this.options.log(`sync state: ${String(error)}`));
    switch (report.status) {
      case 'synced':
        this.phase = 'synced';
        this.problem = null;
        this.retryDelay = 2_000;
        break;
      case 'offline':
        this.phase = 'offline';
        this.problem = null;
        this.retry();
        break;
      case 'auth':
        this.phase = 'attention';
        this.problem = { kind: 'auth', message: 'Sign in again' };
        break;
      case 'quota':
        this.phase = 'attention';
        this.problem = { kind: 'quota', message: 'Google Drive is full', files: report.didNotFit };
        break;
      case 'folder-gone':
        this.phase = 'attention';
        this.problem = { kind: 'folder-gone', message: "The Flint folder is in Drive's trash" };
        break;
      case 'error':
        this.phase = 'attention';
        this.problem = { kind: 'error', message: report.message ?? 'Sync failed' };
        this.options.log(`sync failed: ${report.message ?? ''}`);
        this.retry();
        break;
    }
    if (report.downloaded.length > 0 || report.uploaded.length > 0) {
      this.options.log(
        `sync: ${report.downloaded.length} written here, ${report.uploaded.length} to Drive`,
      );
    }
    await this.countConflicts();
    this.emit();
    // Another PC wrote while this run did, or a note was being typed in: again in a moment.
    if (report.again) {
      clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => void this.request(), AFTER_CHANGE_MS);
      this.changeTimer.unref?.();
    }
  }

  /** Offline or failed: again by itself, backing off up to the 3-minute cycle (D-161 Q8). */
  private retry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.request(), this.retryDelay);
    this.retryTimer.unref?.();
    this.retryDelay = Math.min(this.retryDelay * 2, EVERY_MS);
  }

  /** Unresolved conflict callouts in synced lists and notes (the popover, the note's chip). */
  async countConflicts(): Promise<void> {
    const items = await this.options.items();
    const out: SyncConflict[] = [];
    for (const id of Object.keys(this.state.items)) {
      const text = await this.options.local.read(id);
      if (text === null) continue;
      // Callouts in notes, and in task bodies (indented under their task).
      const count = countConflicts(text.replace(/^[ \t]+(?=>[ \t]?\[!conflict\])/gim, ''));
      if (count > 0)
        out.push({ listId: id, name: items.find((item) => item.id === id)?.name ?? id, count });
    }
    this.conflicts = out;
  }

  private emit(): void {
    this.options.onStatus(this.status());
  }

  status(): SyncStatusView {
    const report = this.lastReport;
    return {
      phase: this.phase,
      email: this.account?.email ?? null,
      lastSync: this.state.lastSync,
      folderId: this.state.folderId,
      // Before the first sync made it: the folder it will be (D-161 Q7).
      folderPath: this.state.folderPath ?? `My Drive › ${this.options.folderName}`,
      mode: this.state.mode,
      synced: Object.keys(this.state.items),
      syncedGroups: this.state.groups
        .map((group) => group.id)
        .filter((id) => this.engine?.wanted(id, () => []) ?? false),
      notices: [...this.state.notices],
      problem: this.problem,
      conflicts: this.conflicts,
      remoteOnly: report?.remoteOnly ?? [],
      remoteGroups: report?.remoteGroups ?? this.state.groups,
      linked: this.state.linked,
      device: this.options.local.device,
      connectError: this.connectError,
    };
  }

  /** What Chosen → Everything would do (D-161 Q9). */
  async previewEverything(): Promise<SyncEverythingPreview> {
    const items = await this.options.items();
    const start = items.filter((item) => !this.state.items[item.id]).length;
    const remote = this.lastReport?.remoteOnly ?? [];
    const stoppedHere = remote.filter((item) => this.state.stopped.includes(item.listId)).length;
    return { start, fromDrive: remote.length, stoppedHere };
  }

  private async save(): Promise<void> {
    await this.options.store.writeState(this.state);
  }

  async act(action: SyncAction): Promise<void> {
    switch (action.kind) {
      case 'connect':
        return this.connect();
      case 'cancel-connect':
        this.signing?.cancel();
        return;
      case 'disconnect':
        return this.disconnect();
      case 'sync-now':
        return this.request();
      case 'mode':
        return this.setMode(action.mode);
      case 'choose':
        return this.choose(action.ids);
      case 'start': {
        if (!this.engine) return;
        this.engine.start([action.id]);
        if (this.state.mode === 'everything') this.state.chosen = [];
        await this.save();
        this.emit();
        return this.request();
      }
      case 'stop': {
        if (!this.engine) return;
        const groups = await this.options.groups();
        this.engine.stop(
          [action.id],
          action.everywhere,
          (id) => groups.find((group) => group.id === id)?.lists ?? [],
        );
        // Stopped here: no longer counted as synced at once.
        for (const id of [
          action.id,
          ...(groups.find((group) => group.id === action.id)?.lists ?? []),
        ]) {
          if (!action.everywhere) delete this.state.items[id];
        }
        await this.save();
        this.emit();
        return this.request();
      }
      case 'dismiss-notice':
        this.state.notices = this.state.notices.filter((id) => id !== action.id);
        await this.save();
        this.emit();
        return;
      case 'open-drive':
        if (action.id !== undefined) {
          const file = this.state.items[action.id];
          if (file) this.options.connection.open(this.options.connection.fileUrl(file.fileId));
          return;
        }
        if (this.state.folderId)
          this.options.connection.open(this.options.connection.folderUrl(this.state.folderId));
        return;
      case 'restore-in-drive':
        this.options.connection.open(this.options.connection.trashUrl);
        return;
      case 'new-folder':
        // Start a new folder: what this PC syncs goes up into a fresh "Flint" folder.
        this.state.folderId = null;
        this.state.folderPath = null;
        this.state.items = {};
        this.state.attachments = {};
        this.state.groups = [];
        await this.options.store.forgetBases();
        this.makeEngine();
        this.problem = null;
        await this.save();
        return this.request();
    }
  }

  private async connect(): Promise<void> {
    if (!this.options.connection.available || this.signing) return;
    this.phase = 'signing-in';
    this.connectError = null;
    this.emit();
    const signIn = this.options.connection.signIn();
    this.signing = signIn;
    try {
      const account = await signIn.result;
      this.account = account;
      await this.options.store.writeAccount(account);
      const reconnect = this.problem?.kind === 'auth' && this.state.mode !== null;
      if (!reconnect) this.state = { ...emptyState() };
      this.problem = null;
      this.makeEngine();
      this.phase = this.state.mode === null ? 'setup' : 'synced';
      await this.save();
      this.schedule();
      this.emit();
      if (this.state.mode !== null) await this.request();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.log(`sign-in: ${message}`);
      if (!(error instanceof Error && error.name === 'SignInCancelled'))
        this.connectError = message;
      this.phase = this.account ? (this.problem ? 'attention' : 'synced') : 'disconnected';
      this.emit();
    } finally {
      this.signing = null;
      this.options.onSignInEnded?.();
    }
  }

  private async disconnect(): Promise<void> {
    const account = this.account;
    this.stopTimers();
    this.account = null;
    this.engine = null;
    this.state = emptyState();
    this.problem = null;
    this.lastReport = null;
    this.conflicts = [];
    await this.options.store.forget();
    this.phase = 'disconnected';
    this.emit();
    if (account) await this.options.connection.revoke(account.refreshToken);
  }

  /** What should sync? (setup), or the switch in Settings (D-161 Q9). */
  private async setMode(mode: 'everything' | 'chosen'): Promise<void> {
    if (!this.engine) return;
    const was = this.state.mode;
    if (mode === 'everything') {
      // Everything really is everything: the stopped-here list is cleared.
      this.state.stopped = [];
      this.state.notices = [];
      this.state.chosen = [];
    } else if (was === 'everything') {
      // Nothing stops: what syncs now becomes the chosen set; only new items stay local.
      this.state.chosen = [
        ...Object.keys(this.state.items),
        ...this.state.groups.map((group) => group.id),
      ];
    }
    this.state.mode = mode;
    if (this.phase === 'setup') this.phase = 'synced';
    await this.save();
    this.emit();
    await this.request();
  }

  /** Choose…: exactly these lists, notes and groups sync here (from this PC or from Drive). */
  private async choose(ids: readonly string[]): Promise<void> {
    if (!this.engine) return;
    const chosen = new Set(ids);
    this.state.chosen = [...chosen];
    this.state.stopped = this.state.stopped.filter((id) => !chosen.has(id));
    this.state.notices = this.state.notices.filter((id) => !chosen.has(id));
    await this.save();
    this.emit();
    await this.request();
  }

  private stopTimers(): void {
    clearTimeout(this.changeTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.everyTimer);
  }

  /** Quitting: no new runs; waits for one under way (at most as long as the quit waits, D-138). */
  async close(): Promise<void> {
    this.stopped = true;
    this.stopTimers();
    this.signing?.cancel();
    await this.running?.catch(() => undefined);
  }
}
