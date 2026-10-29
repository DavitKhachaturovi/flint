const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ATTEMPTS_PER_LENGTH = 32;

/**
 * Creates a new ID: `[a-z0-9]{4,6}` (D-21). Starts with 4 characters (1.7 million possibilities)
 * and only grows when random picks keep colliding with IDs already taken.
 */
export function generateId(
  isTaken: (id: string) => boolean,
  random: () => number = Math.random,
): string {
  for (let length = 4; ; length = Math.min(length + 1, 6)) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_LENGTH; attempt++) {
      let id = '';
      for (let index = 0; index < length; index++) {
        id += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
      }
      if (!isTaken(id)) return id;
    }
  }
}

export interface FileIds {
  /** File path (or any stable name), used to break ties between files created at the same time. */
  readonly file: string;
  /** Creation time in milliseconds. */
  readonly created: number;
  readonly ids: readonly string[];
}

/**
 * When files share IDs (Explorer's "Unicorn - Copy.md", a OneDrive conflict copy, two files
 * claiming `id: inbox`), the older file keeps them: by creation time, then path (D-23). Returns,
 * per file, the IDs that file must replace on its next save. Works for task IDs and list IDs alike.
 */
export function duplicateIdsToReplace(files: readonly FileIds[]): Map<string, Set<string>> {
  const ordered = [...files].sort(
    (a, b) => a.created - b.created || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  const seen = new Set<string>();
  const result = new Map<string, Set<string>>();
  for (const file of ordered) {
    const replace = new Set<string>();
    for (const id of file.ids) if (seen.has(id)) replace.add(id);
    if (replace.size > 0) result.set(file.file, replace);
    for (const id of file.ids) seen.add(id);
  }
  return result;
}
