/**
 * `.flint/space.json` (04 §9, D-189, D-190 Q14): what makes a folder in `Spaces/` a space.
 *
 *   { "flint": 1, "id": "s-k3f9", "name": "Home" }
 *
 * A folder without a valid one is never read as a space (a `Spaces` folder the user already had
 * stays outside Flint). Flint finds a space by its `id`, never by its folder's name. Tolerant reader
 * (unknown keys kept when it is written again), as every bookkeeping file (04 §3).
 */

/** A space's ID: `s-` and 4 to 32 lowercase letters or digits. */
export const SPACE_ID = /^s-[a-z0-9]{4,32}$/;

/** The personal space (the Flint folder itself): never in a `space.json`. */
export const PERSONAL_SPACE = 'personal';

/** The longest space name, as group names (D-79). */
export const SPACE_NAME_MAX = 60;

export interface SpaceFile {
  readonly id: string;
  readonly name: string;
  /** Keys this version doesn't know, kept as they were. */
  readonly extra: Readonly<Record<string, unknown>>;
}

/** A space name as typed: trimmed, inner whitespace collapsed; `null` when empty or too long. */
export function cleanSpaceName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '' || [...name].length > SPACE_NAME_MAX) return null;
  // No control characters (they could hide in a name read from someone else's file).
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return null;
  }
  return name;
}

/** Reads `space.json`; `null` when it is missing, not JSON, or has no valid `id` and `name`. */
export function readSpaceFile(text: string | null): SpaceFile | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const id = record['id'];
  const rawName = record['name'];
  if (typeof id !== 'string' || !SPACE_ID.test(id)) return null;
  if (typeof rawName !== 'string') return null;
  const name = cleanSpaceName(rawName);
  if (name === null) return null;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'flint' && key !== 'id' && key !== 'name') extra[key] = value;
  }
  return { id, name, extra };
}

/** Writes `space.json`: Flint's keys first, then the ones it keeps. */
export function writeSpaceFile(space: SpaceFile): string {
  return `${JSON.stringify({ flint: 1, id: space.id, name: space.name, ...space.extra }, null, 2)}\n`;
}
