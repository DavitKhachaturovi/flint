import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LinkPattern } from '../../shared/link-patterns.js';
import type { AgentStep } from '../capture/workspace.js';
import { writeFileAtomic } from '../storage/atomic.js';

/**
 * AGENT-07 (D-185 Q5): Recent agent changes, in `%APPDATA%\Flint\agent-changes.json` (docs/04 §2):
 * one entry per request, with what it did as data so it can be undone, also after a restart. The
 * last 100 changes or 7 days are kept.
 */
export interface AgentChange {
  readonly id: string;
  readonly agent: string;
  /** "Added 5 tasks to Backend". */
  readonly label: string;
  /** When, ms. */
  readonly at: number;
  readonly steps: readonly AgentStep[];
  readonly linkPatterns?: {
    readonly before: readonly LinkPattern[];
    readonly after: readonly LinkPattern[];
  };
  /** False for archiving done tasks (restored from Trash → Archived instead). */
  readonly undoable: boolean;
  readonly undone?: boolean;
}

const KEEP = 100;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export class AgentChangeLog {
  private changes: AgentChange[] = [];
  private readonly listeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();
  private counter = 0;
  readonly path: string;

  constructor(userData: string) {
    this.path = join(userData, 'agent-changes.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      const list =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)['changes']
          : undefined;
      this.changes = Array.isArray(list)
        ? list.filter(
            (each): each is AgentChange =>
              typeof each === 'object' &&
              each !== null &&
              typeof (each as AgentChange).id === 'string' &&
              typeof (each as AgentChange).label === 'string' &&
              typeof (each as AgentChange).at === 'number' &&
              Array.isArray((each as AgentChange).steps),
          )
        : [];
    } catch {
      this.changes = [];
    }
  }

  /** Newest first, within what is kept. */
  list(now: number): AgentChange[] {
    return this.changes
      .filter((change) => now - change.at < KEEP_MS)
      .slice(-KEEP)
      .reverse();
  }

  get(id: string): AgentChange | undefined {
    return this.changes.find((change) => change.id === id);
  }

  /** The newest change that can still be undone (the palette's Undo last agent change). */
  last(now: number): AgentChange | undefined {
    return this.list(now).find((change) => change.undoable && !change.undone);
  }

  add(change: Omit<AgentChange, 'id'>, now: number): AgentChange {
    this.counter += 1;
    const entry: AgentChange = { ...change, id: `${change.at.toString(36)}-${this.counter}` };
    this.changes = [...this.changes.filter((each) => now - each.at < KEEP_MS), entry].slice(-KEEP);
    this.save();
    return entry;
  }

  markUndone(id: string): void {
    this.changes = this.changes.map((change) =>
      change.id === id ? { ...change, undone: true } : change,
    );
    this.save();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** D-138: resolves once what was saved is on disk. */
  settled(): Promise<void> {
    return this.writing;
  }

  private save(): void {
    for (const listener of this.listeners) listener();
    const text = `${JSON.stringify({ flint: 1, changes: this.changes })}\n`;
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFileAtomic(this.path, text, { tempDirectory: dirname(this.path) });
      })
      .catch(() => undefined);
  }
}
