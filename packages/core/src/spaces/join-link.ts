/**
 * The join link of a shared space (SPACE-06, D-189 Q6, D-190 Q8): the line Flint adds to the
 * provider's invite e-mail, and the `flint://join` address the site's join page hands to Flint.
 *
 *   https://flintnotes.app/join#g=<space file ID>.<attachments file ID>&n=<space name>[&d=1]
 *   flint://join?g=<…>&n=<…>            (flint-dev://join in development builds)
 *
 * `g` is a Google Drive space: its two files (`.flintspace`, `.flintfiles`), both picked in one
 * Select. `m` (OneDrive, S5) will be the base64url of the sharing link. Everything sits after the
 * `#`, which browsers never send to a server, so flintnotes.app never learns which space. The link
 * is outside content: it is parsed strictly, and a link that doesn't match is no link at all.
 */

export const JOIN_PAGE = 'https://flintnotes.app/join';

/** The longest space name a link carries (names are at most 60 characters, like groups'). */
export const JOIN_NAME_MAX = 60;

/** A Google Drive file ID: letters, digits, `-` and `_` (Drive's own alphabet). */
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export interface GoogleJoin {
  readonly provider: 'google';
  /** The space's `.flintspace` file. */
  readonly spaceFile: string;
  /** The space's `.flintfiles` file (its attachments). */
  readonly filesFile: string;
  /** The space's name as the link says it (checked once Flint can open the file). */
  readonly name: string;
  /** Made by a development build: opens `flint-dev://`, never an installed Flint. */
  readonly development: boolean;
}

export type JoinRequest = GoogleJoin;

/** A name from a link, made safe to show: no control characters, trimmed, at most 60 characters. */
export function cleanJoinName(raw: string): string {
  let cleaned = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    // Tabs and line breaks separate words: they become spaces (collapsed below).
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      cleaned += ' ';
      continue;
    }
    // C0 and C1 controls, and the bidirectional overrides that could disguise a name.
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
    cleaned += char;
  }
  const collapsed = cleaned.replace(/\s+/g, ' ').trim();
  return [...collapsed].slice(0, JOIN_NAME_MAX).join('');
}

/**
 * `a=1&b=2` as a map (core has no `URLSearchParams`: it runs without browser or Node globals).
 * `+` reads as a space, as forms write it. A repeated or malformed key makes the whole thing `null`.
 */
function readParams(query: string): Map<string, string> | null {
  const params = new Map<string, string>();
  if (query === '') return params;
  for (const part of query.split('&')) {
    if (part === '') continue;
    const equals = part.indexOf('=');
    const rawKey = equals === -1 ? part : part.slice(0, equals);
    const rawValue = equals === -1 ? '' : part.slice(equals + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    if (params.has(key)) return null;
    params.set(key, value);
  }
  return params;
}

function fromParams(params: Map<string, string> | null): JoinRequest | null {
  if (!params) return null;
  const google = params.get('g');
  if (google === undefined) return null;
  const ids = google.split('.');
  if (ids.length !== 2) return null;
  const [spaceFile, filesFile] = ids as [string, string];
  if (!DRIVE_ID.test(spaceFile) || !DRIVE_ID.test(filesFile) || spaceFile === filesFile)
    return null;
  const name = cleanJoinName(params.get('n') ?? '');
  if (name === '') return null;
  const flag = params.get('d');
  if (flag !== undefined && flag !== '1') return null;
  return { provider: 'google', spaceFile, filesFile, name, development: flag === '1' };
}

function toParams(request: JoinRequest): string {
  const parts = [
    `g=${request.spaceFile}.${request.filesFile}`,
    `n=${encodeURIComponent(cleanJoinName(request.name))}`,
  ];
  if (request.development) parts.push('d=1');
  return parts.join('&');
}

/** The link for the invite e-mail. */
export function joinPageLink(request: JoinRequest): string {
  return `${JOIN_PAGE}#${toParams(request)}`;
}

/** The address the join page opens (and a test can hand to Flint directly). */
export function joinAppLink(request: JoinRequest): string {
  const scheme = request.development ? 'flint-dev' : 'flint';
  return `${scheme}://join?${toParams(request)}`;
}

/** Reads a join page link (`https://flintnotes.app/join#…`), as pasted into Join with an invite link. */
export function parseJoinPageLink(text: string): JoinRequest | null {
  const link = text.trim();
  const hash = link.indexOf('#');
  if (hash === -1) return null;
  // Exactly the page (case-insensitive host, an optional trailing slash, no query, port or user).
  const page = link.slice(0, hash).replace(/\/$/, '');
  if (page.toLowerCase() !== JOIN_PAGE) return null;
  return fromParams(readParams(link.slice(hash + 1)));
}

/**
 * Reads a `flint://join?…` address handed to Flint by Windows, for this build's scheme only (an
 * installed Flint never acts on a development link, and the other way round).
 */
export function parseJoinAppLink(text: string, scheme: string): JoinRequest | null {
  const query = text.indexOf('?');
  if (query === -1) return null;
  // Exactly `<scheme>://join?` (Windows may add a slash before the query: `join/?`).
  const head = text.slice(0, query).replace(/\/$/, '');
  if (head !== `${scheme}://join`) return null;
  const hash = text.indexOf('#', query);
  const request = fromParams(readParams(text.slice(query + 1, hash === -1 ? undefined : hash)));
  if (!request || request.development !== (scheme === 'flint-dev')) return null;
  return request;
}

/** The first join address among a launch's arguments, if any. */
export function findJoinAppLink(argv: readonly string[], scheme: string): JoinRequest | null {
  for (const argument of argv) {
    const request = parseJoinAppLink(argument, scheme);
    if (request) return request;
  }
  return null;
}

/**
 * The note in the provider's invite e-mail (SPACE-05): the person's own note, a blank line, and
 * Flint's line. The provider's e-mail is plain text, so the link stands on its own line.
 */
export function inviteMessage(note: string, request: JoinRequest): string {
  const line = `Join ${cleanJoinName(request.name)} in Flint: ${joinPageLink(request)}`;
  const own = note.trim();
  return own === '' ? line : `${own}\n\n${line}`;
}
