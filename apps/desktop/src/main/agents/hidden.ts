import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '../storage/atomic.js';
import { tempDirectoryFor } from '../storage/list-file.js';

/**
 * AGENT-06 (D-185 Q15): the lists, notes and groups hidden from AI agents, in `.flint/agents.json`
 * (docs/04 §2): `{ "flint": 1, "hidden": { id: time }, "shown": { id: time } }`. The times are
 * when each was last hidden or shown, so sync can take the later change (04 §7). Tolerant: a
 * missing or broken file hides nothing; unknown keys are kept.
 */
export class HiddenFile {
  private hidden = new Map<string, string>();
  private shown = new Map<string, string>();
  private extra: Record<string, unknown> = {};
  private readonly listeners = new Set<() => void>();
  readonly path: string;

  constructor(folder: string) {
    this.path = join(folder, '.flint', 'agents.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      const {
        hidden,
        shown,
        flint: _version,
        ...extra
      } = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      void _version;
      this.extra = extra;
      this.hidden = times(hidden);
      this.shown = times(shown);
    } catch {
      this.hidden = new Map();
      this.shown = new Map();
    }
  }

  isHidden(id: string): boolean {
    return this.hidden.has(id);
  }

  ids(): string[] {
    return [...this.hidden.keys()];
  }

  /** Every item ever hidden or shown here (sync carries each one's latest change). */
  knownIds(): string[] {
    return [...new Set([...this.hidden.keys(), ...this.shown.keys()])];
  }

  /** The user hides or shows an item (never an agent). */
  async set(id: string, hide: boolean, now: Date): Promise<void> {
    if (hide === this.hidden.has(id)) return;
    const at = now.toISOString();
    if (hide) {
      this.hidden.set(id, at);
      this.shown.delete(id);
    } else {
      this.hidden.delete(id);
      this.shown.set(id, at);
    }
    await this.write();
    for (const listener of this.listeners) listener();
  }

  /** SYNC-01 (04 §7): another device's flag for an item, taken when it is the later change. */
  async adopt(id: string, hide: boolean, at: string): Promise<void> {
    const mine = this.hidden.get(id) ?? this.shown.get(id);
    if (mine !== undefined && mine >= at) return;
    if (hide === this.hidden.has(id) && mine !== undefined) return;
    if (hide) {
      this.hidden.set(id, at);
      this.shown.delete(id);
    } else {
      this.hidden.delete(id);
      this.shown.set(id, at);
    }
    await this.write();
    for (const listener of this.listeners) listener();
  }

  /** When an item was last hidden or shown (for sync), or undefined. */
  changedAt(id: string): { readonly hidden: boolean; readonly at: string } | undefined {
    const hiddenAt = this.hidden.get(id);
    if (hiddenAt !== undefined) return { hidden: true, at: hiddenAt };
    const shownAt = this.shown.get(id);
    return shownAt === undefined ? undefined : { hidden: false, at: shownAt };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const sorted = (map: Map<string, string>): Record<string, string> =>
      Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
    await writeFileAtomic(
      this.path,
      `${JSON.stringify({ ...this.extra, flint: 1, hidden: sorted(this.hidden), shown: sorted(this.shown) }, null, 2)}\n`,
      { tempDirectory: tempDirectoryFor(this.path) },
    );
  }
}

function times(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof value !== 'object' || value === null) return map;
  for (const [id, at] of Object.entries(value as Record<string, unknown>))
    if (typeof at === 'string') map.set(id, at);
  return map;
}
