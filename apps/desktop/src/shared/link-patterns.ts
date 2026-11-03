/**
 * Link patterns (NOTE-07, TASK-10, D-84): a short form and a URL with named placeholders, per user
 * in `settings.json` (`linkPatterns`). Each works both ways: a typed short form (`AB#1234`) becomes
 * a link, and a pasted full URL displays as its short form. M8's Settings builds patterns from an
 * example (`inferLinkPattern`) or a preset; this module has no company URLs of its own.
 *
 * A placeholder in both the short form and the URL is the part that varies; one only in the URL is
 * fixed by the user's example (presets fill those from it). Only http(s) URLs.
 */

export interface LinkPattern {
  /** The short form, e.g. `AB#{id}`. */
  readonly short: string;
  /** The URL, e.g. `https://dev.azure.com/acme/web/_workitems/edit/{id}`. */
  readonly url: string;
  /** What each varying placeholder matches; digits when not given. */
  readonly kinds?: Readonly<Record<string, 'digits' | 'word'>>;
}

const PLACEHOLDER = /\{([a-z][a-z0-9]*)\}/gi;
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KIND_SOURCE = { digits: '\\d+', word: '[A-Za-z0-9][A-Za-z0-9_.-]*' } as const;

const placeholders = (template: string): string[] =>
  [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');

/** A tolerant reader for the settings: anything that isn't a usable pattern is left out. */
export function readLinkPatterns(stored: unknown): LinkPattern[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((item): LinkPattern[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { short, url, kinds } = item as Record<string, unknown>;
    if (typeof short !== 'string' || typeof url !== 'string') return [];
    if (!/^https?:\/\//i.test(url)) return [];
    const varying = placeholders(short);
    if (varying.length === 0 || varying.some((name) => !placeholders(url).includes(name)))
      return [];
    const cleanKinds: Record<string, 'digits' | 'word'> = {};
    if (typeof kinds === 'object' && kinds !== null)
      for (const [name, kind] of Object.entries(kinds as Record<string, unknown>))
        if (kind === 'digits' || kind === 'word') cleanKinds[name] = kind;
    return [{ short, url, ...(Object.keys(cleanKinds).length > 0 && { kinds: cleanKinds }) }];
  });
}

/** A pattern ready to match, in either direction. */
export interface CompiledPattern {
  readonly pattern: LinkPattern;
  /** Finds the short form in text (between non-word characters). */
  readonly shortForm: RegExp;
  /** Matches a whole URL. */
  readonly fullUrl: RegExp;
  readonly names: readonly string[];
}

function source(template: string, pattern: LinkPattern): string {
  let out = '';
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    out += escapeRegex(template.slice(last, match.index));
    const kind = pattern.kinds?.[name] ?? 'digits';
    out += `(?<${name}>${KIND_SOURCE[kind]})`;
    last = match.index + match[0].length;
  }
  return out + escapeRegex(template.slice(last));
}

export function compileLinkPatterns(patterns: readonly LinkPattern[]): CompiledPattern[] {
  return patterns.flatMap((pattern): CompiledPattern[] => {
    try {
      return [
        {
          pattern,
          shortForm: new RegExp(`(?<![\\w#/])${source(pattern.short, pattern)}(?![\\w])`, 'g'),
          fullUrl: new RegExp(`^${source(pattern.url, pattern)}/?$`, 'i'),
          names: placeholders(pattern.short),
        },
      ];
    } catch {
      return [];
    }
  });
}

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);

/** A link found in text: where the short form is, and where it goes. */
export interface FoundLink {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly href: string;
}

/** The short forms in `text` (`AB#1234` → its URL), in order, never overlapping. */
export function findShortForms(text: string, compiled: readonly CompiledPattern[]): FoundLink[] {
  const found: FoundLink[] = [];
  for (const each of compiled) {
    each.shortForm.lastIndex = 0;
    for (const match of text.matchAll(each.shortForm)) {
      const from = match.index;
      const to = from + match[0].length;
      if (found.some((other) => from < other.to && to > other.from)) continue;
      found.push({ from, to, text: match[0], href: fill(each.pattern.url, match.groups ?? {}) });
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

/** TASK-10, D-84: a full URL's short form when one of the patterns knows it, else null. */
export function shortFormOf(url: string, compiled: readonly CompiledPattern[]): string | null {
  for (const each of compiled) {
    const match = each.fullUrl.exec(url.trim());
    if (match) return fill(each.pattern.short, match.groups ?? {});
  }
  return null;
}

/** The patterns the renderers use; the main window sets them from the settings. */
let active: CompiledPattern[] = [];
let version = 0;
export function setLinkPatterns(patterns: readonly LinkPattern[]): void {
  active = compileLinkPatterns(patterns);
  version++;
}
export const activeLinkPatterns = (): readonly CompiledPattern[] => active;
/** Changes whenever the patterns do: rendered text that depends on them is made again. */
export const linkPatternsVersion = (): number => version;

/** Presets for M8's editor (D-84): what to recognise in an example link; no company URLs. */
export interface LinkPreset {
  readonly label: string;
  /** The URL shape; `{…}` parts come from the example. */
  readonly url: string;
  /** The short form it suggests. */
  readonly short: string;
  readonly kinds?: Readonly<Record<string, 'digits' | 'word'>>;
}

export const LINK_PRESETS: readonly LinkPreset[] = [
  {
    label: 'Azure DevOps work item',
    url: 'https://dev.azure.com/{org}/{project}/_workitems/edit/{id}',
    short: 'AB#{id}',
    kinds: { org: 'word', project: 'word' },
  },
  {
    label: 'Azure DevOps pull request',
    url: 'https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}',
    short: 'PR {id}',
    kinds: { org: 'word', project: 'word', repo: 'word' },
  },
  {
    label: 'GitHub issue',
    url: 'https://github.com/{owner}/{repo}/issues/{n}',
    short: '{repo}#{n}',
    kinds: { owner: 'word', repo: 'word' },
  },
  {
    label: 'GitHub pull request',
    url: 'https://github.com/{owner}/{repo}/pull/{n}',
    short: '{repo}!{n}',
    kinds: { owner: 'word', repo: 'word' },
  },
  {
    label: 'Jira issue',
    url: 'https://{site}.atlassian.net/browse/{key}-{n}',
    short: '{key}-{n}',
    kinds: { site: 'word', key: 'word' },
  },
];

/**
 * A preset that fits an example link, as the user's pattern: the parts only in the URL fixed from
 * the example (`acme`, `web`), the ones in the short form left to vary. Null when none fits.
 */
export function patternFromPreset(
  example: string,
): { preset: LinkPreset; pattern: LinkPattern } | null {
  for (const preset of LINK_PRESETS) {
    const matcher = compileLinkPatterns([
      {
        short: preset.short,
        url: preset.url,
        kinds: Object.fromEntries(
          placeholders(preset.url).map((name) => [name, preset.kinds?.[name] ?? 'digits']),
        ),
      },
    ])[0];
    const match = matcher?.fullUrl.exec(example.trim());
    if (!match?.groups) continue;
    const varying = new Set(placeholders(preset.short));
    const fixed = Object.fromEntries(
      Object.entries(match.groups).filter(([name]) => !varying.has(name)),
    );
    const kinds = Object.fromEntries(
      [...varying].map((name) => [name, preset.kinds?.[name] ?? 'digits'] as const),
    );
    return {
      preset,
      pattern: {
        short: fill(
          preset.short,
          Object.fromEntries([...varying].map((name) => [name, `{${name}}`])),
        ),
        url: fill(preset.url, fixed),
        kinds,
      },
    };
  }
  return null;
}

export interface Inference {
  readonly pattern: LinkPattern | null;
  /** Several parts could be the varying one: ask for a second example. */
  readonly ambiguous: boolean;
  readonly problem?: string;
}

const TOKEN = /[A-Za-z0-9]+/g;

/**
 * NOTE-07, D-84: a pattern from examples (an example link and the short form wanted): what varies is
 * the part present in both. With one example, a number present in both is taken as varying and
 * anything else in both makes it ambiguous; a second example settles which parts vary (they differ
 * between the examples).
 */
export function inferLinkPattern(
  examples: readonly { readonly url: string; readonly short: string }[],
): Inference {
  const first = examples[0];
  if (!first) return { pattern: null, ambiguous: false, problem: 'Paste an example link.' };
  const url = first.url.trim();
  const short = first.short.trim();
  if (!/^https?:\/\//i.test(url))
    return { pattern: null, ambiguous: false, problem: 'The link must start with https://.' };
  const urlTokens = new Map<string, number>();
  for (const match of url.matchAll(TOKEN))
    urlTokens.set(match[0], (urlTokens.get(match[0]) ?? 0) + 1);
  const shared = [...short.matchAll(TOKEN)]
    .map((match) => ({ text: match[0], index: match.index }))
    .filter((token) => urlTokens.has(token.text));
  if (shared.length === 0)
    return {
      pattern: null,
      ambiguous: false,
      problem: 'The short form needs a part of the link, like its number.',
    };
  // With a second example, the parts that differ between the two are the varying ones.
  const second = examples[1];
  let varying: { text: string; index: number }[];
  let ambiguous = false;
  if (second) {
    const otherShort = [...second.short.trim().matchAll(TOKEN)].map((match) => match[0]);
    const mine = [...short.matchAll(TOKEN)].map((match) => match[0]);
    varying = shared.filter((token) => {
      const at = mine.indexOf(token.text);
      return at >= 0 && otherShort[at] !== undefined && otherShort[at] !== token.text;
    });
    if (varying.length === 0) varying = shared.filter((token) => /^\d+$/.test(token.text));
  } else {
    varying = shared.filter((token) => /^\d+$/.test(token.text));
    if (varying.length === 0) varying = shared;
    ambiguous =
      shared.some((token) => !/^\d+$/.test(token.text)) ||
      varying.some((token) => (urlTokens.get(token.text) ?? 0) > 1);
  }
  const names = varying.map((_, index) => (varying.length === 1 ? 'id' : `p${index + 1}`));
  let shortTemplate = short;
  let urlTemplate = url;
  const kinds: Record<string, 'digits' | 'word'> = {};
  // Replace from the end, so earlier indexes stay valid in the short form.
  [...varying]
    .map((token, index) => ({ ...token, name: names[index] ?? 'id' }))
    .sort((a, b) => b.index - a.index)
    .forEach((token) => {
      shortTemplate =
        shortTemplate.slice(0, token.index) +
        `{${token.name}}` +
        shortTemplate.slice(token.index + token.text.length);
      kinds[token.name] = /^\d+$/.test(token.text) ? 'digits' : 'word';
    });
  for (const [index, token] of varying.entries()) {
    const name = names[index] ?? 'id';
    // The last place it is in the link (ids end URLs).
    const at = lastToken(urlTemplate, token.text);
    if (at < 0) continue;
    urlTemplate =
      urlTemplate.slice(0, at) + `{${name}}` + urlTemplate.slice(at + token.text.length);
  }
  const pattern: LinkPattern = { short: shortTemplate, url: urlTemplate, kinds };
  // The examples must come out of the pattern again.
  const compiled = compileLinkPatterns([pattern]);
  for (const example of examples)
    if (shortFormOf(example.url, compiled) !== example.short.trim())
      return { pattern, ambiguous: true, problem: 'The examples don’t follow one pattern.' };
  return { pattern, ambiguous };
}

/** Where `token` stands last in `text` as a whole token. */
function lastToken(text: string, token: string): number {
  let found = -1;
  for (const match of text.matchAll(TOKEN)) if (match[0] === token) found = match.index;
  return found;
}

/**
 * TASK-10, D-84, D-88: the presets as built-in recognizers, for smart link titles (every part of
 * their URLs varies: they hold no company's address).
 */
const BUILT_IN = compileLinkPatterns(
  LINK_PRESETS.map((preset) => ({
    short: preset.short,
    url: preset.url,
    kinds: Object.fromEntries(
      placeholders(preset.url).map((name) => [name, preset.kinds?.[name] ?? 'digits'] as const),
    ),
  })),
);

/** The most characters a smart link title of another address shows (TASK-10). */
const TITLE_LIMIT = 40;

/**
 * TASK-10 (D-88): how a pasted URL shows: the user's link pattern's short form (D-84), else a
 * built-in recognizer's (`PR 42`, `AB#1234`, `web#12`), else its domain and a shortened path
 * (`example.com/docs/…/setup`). Only the display: the full URL stays in the file.
 */
export function linkTitle(url: string, compiled: readonly CompiledPattern[]): string {
  const known = shortFormOf(url, compiled) ?? shortFormOf(url, BUILT_IN);
  if (known) return known;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url;
  }
  if (!/^https?:$/.test(parsed.protocol)) return url;
  const host = parsed.hostname.replace(/^www\./, '');
  const parts = parsed.pathname
    .split('/')
    .filter((part) => part !== '')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const whole = [host, ...parts].join('/');
  if (whole.length <= TITLE_LIMIT) return whole;
  const first = parts[0] ?? '';
  const last = parts.at(-1) ?? '';
  const room = Math.max(8, TITLE_LIMIT - host.length - first.length - 4);
  const end = last.length > room ? `${last.slice(0, room - 1)}…` : last;
  return parts.length <= 1 ? `${host}/${end}` : `${host}/${first}/…/${end}`;
}
