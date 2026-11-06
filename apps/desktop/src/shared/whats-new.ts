/**
 * APP-15, D-117: the What's new card's text, read from `docs/whats-new.md` (bundled with the app):
 * a `## 0.8.16` heading per version, newest first, each with a few plain-language highlights.
 */

export interface WhatsNewEntry {
  /** `0.8.16`. */
  readonly version: string;
  /** The heading after the version, if any (`(6 Nov 2026)`), without brackets. */
  readonly date: string | null;
  /** The entry's markdown, without its heading. */
  readonly markdown: string;
}

const HEADING = /^##\s+(\d+\.\d+\.\d+)\s*(?:\((.*?)\))?\s*$/;

/** Every version's entry, in the file's order (newest first). Text before the first is left out. */
export function readWhatsNew(text: string): WhatsNewEntry[] {
  const entries: WhatsNewEntry[] = [];
  let current: { version: string; date: string | null; lines: string[] } | null = null;
  const close = (): void => {
    if (current)
      entries.push({
        version: current.version,
        date: current.date,
        markdown: current.lines.join('\n').trim(),
      });
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      current = { version: heading[1] ?? '', date: heading[2]?.trim() || null, lines: [] };
    } else if (current) current.lines.push(line);
  }
  close();
  return entries.filter((entry) => entry.markdown !== '');
}

/** Compares `1.2.3` versions: negative when `a` is older. Missing or odd parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string): number[] =>
    version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * D-117: what to show after an update: every entry newer than `lastSeen` up to `current`, newest
 * first. With no `lastSeen` (an install from before What's new), only the newest entry up to
 * `current` (D-118).
 */
export function entriesSince(
  entries: readonly WhatsNewEntry[],
  lastSeen: string | null,
  current: string,
): WhatsNewEntry[] {
  const upToNow = entries
    .filter((entry) => compareVersions(entry.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  if (lastSeen === null) return upToNow.slice(0, 1);
  return upToNow.filter((entry) => compareVersions(entry.version, lastSeen) > 0);
}
