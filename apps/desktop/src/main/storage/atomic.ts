import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * Atomic writes (DATA-01, docs/04 §6): write a temporary file on the same volume, flush it to disk,
 * then rename it over the original. A crash or power loss leaves the old or the new file, never a
 * half-written one. On Windows, antivirus, the search indexer or OneDrive can hold a file for a
 * moment; the rename is retried with backoff instead of failing.
 */

/** Errors Windows reports while another process briefly holds the file. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400, 800];

export interface AtomicWriteOptions {
  /** Folder for temporary files; must be on the same volume (Flint uses `.flint/tmp`). */
  readonly tempDirectory: string;
  /** Replaceable for tests. */
  readonly renameFile?: (from: string, to: string) => Promise<void>;
  readonly wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

export async function writeFileAtomic(
  path: string,
  text: string,
  options: AtomicWriteOptions,
): Promise<void> {
  const renameFile = options.renameFile ?? rename;
  const wait = options.wait ?? sleep;
  await mkdir(options.tempDirectory, { recursive: true });
  const temp = join(
    options.tempDirectory,
    `${basename(path)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await renameFile(temp, path);
        return;
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !TRANSIENT.has(code(error) ?? '')) throw error;
        await wait(delay);
      }
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export type ReadResult =
  | { readonly kind: 'text'; readonly text: string }
  /** Not valid UTF-8: opened read-only so nothing is destroyed (docs/04 §6). */
  | { readonly kind: 'not-utf8' }
  | { readonly kind: 'missing' }
  /** Locked, or cloud-only and unavailable (D-24): shown plainly, never as an empty list. */
  | { readonly kind: 'unreadable'; readonly reason: string };

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Reads a list file as text, keeping a BOM (the format keeps it, docs/04 §6). */
export async function readListFile(path: string): Promise<ReadResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (code(error) === 'ENOENT') return { kind: 'missing' };
    return { kind: 'unreadable', reason: code(error) ?? String(error) };
  }
  try {
    return { kind: 'text', text: decoder.decode(bytes) };
  } catch {
    return { kind: 'not-utf8' };
  }
}
