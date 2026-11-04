import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { writeFileAtomic } from './atomic.js';

/**
 * Local snapshots of the Flint folder (DATA-04, D-84, D-97, docs/04 §Snapshots), in app data
 * (`%LOCALAPPDATA%\\Flint\\snapshots`): each snapshot is a small manifest (every file's path and the
 * hash of its contents); the contents themselves are stored once, compressed, by hash (`blobs/`),
 * so an unchanged file, a large attachment especially, is never stored twice. A snapshot is taken
 * only when something changed. Retention (Q-05, D-97): every snapshot of the last hour, then one an
 * hour for 48 hours, then one a day for 30 days; blobs nothing refers to any more go.
 */

export interface Snapshot {
  /** Its manifest's name: `2026-11-04-153012` (sorts by time). */
  readonly id: string;
  readonly at: Date;
  /** Path (relative to the Flint folder, `/`-separated) → content hash. */
  readonly files: Readonly<Record<string, string>>;
}

interface Manifest {
  readonly flint: 1;
  readonly at: string;
  readonly files: Record<string, string>;
}

const ID = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/;

function idOf(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
}

/**
 * Folders never in a snapshot: temp files, and (D-97, Proposed) a `.git` folder, which keeps its
 * own history; everything else of the user's is in (DATA-04).
 */
const SKIPPED = new Set(['.tmp', 'node_modules', '.git']);

export class SnapshotStore {
  /** path → [mtime, size, hash]: a file unchanged since it was last hashed isn't read again. */
  private readonly hashes = new Map<string, readonly [number, number, string]>();

  private readonly folder: string;
  private readonly store: string;

  constructor(folder: string, store: string) {
    this.folder = folder;
    this.store = store;
  }

  private get blobs(): string {
    return join(this.store, 'blobs');
  }

  /** The Flint folder as it is now: every file's relative path and content hash. */
  async current(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (at: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      const items = await readdir(at, { withFileTypes: true }).catch(() => []);
      for (const item of items) {
        const path = join(at, item.name);
        if (item.isDirectory()) {
          if (!SKIPPED.has(item.name)) await walk(path, depth + 1);
          continue;
        }
        if (!item.isFile() || item.name.endsWith('.tmp')) continue;
        const info = await stat(path).catch(() => null);
        if (!info) continue;
        const key = relative(this.folder, path).split(sep).join('/');
        const known = this.hashes.get(key);
        let hash = known && known[0] === info.mtimeMs && known[1] === info.size ? known[2] : null;
        if (!hash) {
          const content = await readFile(path).catch(() => null);
          if (!content) continue;
          hash = createHash('sha256').update(content).digest('hex');
          this.hashes.set(key, [info.mtimeMs, info.size, hash]);
          // Stored as soon as it is known: a later snapshot needs only its manifest.
          await this.keep(hash, content);
        }
        files[key] = hash;
      }
    };
    await walk(this.folder, 0);
    return files;
  }

  private async keep(hash: string, content: Buffer): Promise<void> {
    const path = join(this.blobs, hash.slice(0, 2), hash);
    if (
      await stat(path).then(
        () => true,
        () => false,
      )
    )
      return;
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, gzipSync(content), { tempDirectory: dirname(path) });
  }

  /** A file's contents in a snapshot. */
  async content(hash: string): Promise<Buffer | null> {
    const data = await readFile(join(this.blobs, hash.slice(0, 2), hash)).catch(() => null);
    return data ? gunzipSync(data) : null;
  }

  /** Every snapshot, newest first. */
  async list(): Promise<Snapshot[]> {
    const names = await readdir(this.store).catch(() => [] as string[]);
    const snapshots: Snapshot[] = [];
    for (const name of names) {
      const match = ID.exec(name);
      if (!match) continue;
      const manifest = await readFile(join(this.store, name), 'utf8')
        .then((text) => JSON.parse(text) as Manifest)
        .catch(() => null);
      if (!manifest?.files) continue;
      const [, year, month, day, hour, minute, second] = match.map(Number);
      snapshots.push({
        id: name.slice(0, -5),
        at: new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0),
        files: manifest.files,
      });
    }
    return snapshots.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /**
   * Takes a snapshot if anything changed since the last one (`force`: also when nothing did, for
   * the safety snapshot before a restore); the new snapshot, or null when nothing changed.
   */
  async take(now: Date, force = false): Promise<Snapshot | null> {
    const files = await this.current();
    const last = (await this.list())[0];
    const same =
      last !== undefined &&
      Object.keys(files).length === Object.keys(last.files).length &&
      Object.entries(files).every(([path, hash]) => last.files[path] === hash);
    if (same && !force) return null;
    if (same && last) return last;
    let at = now;
    // Two in the same second (a forced one right after a scheduled one) get distinct names.
    while (last && idOf(at) <= last.id) at = new Date(at.getTime() + 1000);
    const id = idOf(at);
    const manifest: Manifest = { flint: 1, at: at.toISOString(), files };
    await mkdir(this.store, { recursive: true });
    await writeFileAtomic(join(this.store, `${id}.json`), `${JSON.stringify(manifest)}\n`, {
      tempDirectory: this.store,
    });
    return { id, at, files };
  }

  /**
   * Q-05, D-97: what is kept: everything from the last hour, then the newest of each hour for 48
   * hours, then the newest of each day for 30 days; older or redundant snapshots go, then the
   * blobs no snapshot uses. How many snapshots went.
   */
  async prune(now: Date): Promise<number> {
    const snapshots = await this.list();
    const keep = new Set<string>();
    const hours = new Set<string>();
    const days = new Set<string>();
    for (const snapshot of snapshots) {
      const age = now.getTime() - snapshot.at.getTime();
      const hour = snapshot.id.slice(0, 13);
      const day = snapshot.id.slice(0, 10);
      if (age <= 3_600_000) keep.add(snapshot.id);
      else if (age <= 48 * 3_600_000) {
        if (!hours.has(hour)) keep.add(snapshot.id);
      } else if (age <= 30 * 86_400_000) {
        if (!days.has(day)) keep.add(snapshot.id);
      }
      hours.add(hour);
      days.add(day);
    }
    // The newest is always kept, however old.
    if (snapshots[0]) keep.add(snapshots[0].id);
    let removed = 0;
    for (const snapshot of snapshots) {
      if (keep.has(snapshot.id)) continue;
      await unlink(join(this.store, `${snapshot.id}.json`)).catch(() => undefined);
      removed++;
    }
    const used = new Set(
      snapshots.filter((each) => keep.has(each.id)).flatMap((each) => Object.values(each.files)),
    );
    for (const hash of this.hashes.values()) used.add(hash[2]);
    for (const shard of await readdir(this.blobs).catch(() => [] as string[])) {
      const folder = join(this.blobs, shard);
      const names = await readdir(folder).catch(() => [] as string[]);
      for (const name of names)
        if (!used.has(name)) await unlink(join(folder, name)).catch(() => undefined);
      if (names.every((name) => !used.has(name)))
        await rm(folder, { recursive: true, force: true });
    }
    return removed;
  }
}
