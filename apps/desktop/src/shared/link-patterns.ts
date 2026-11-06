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
  /** D-105: the examples it was made from, so Edit opens the editor as it was left. */
  readonly examples?: readonly LinkExample[];
}

/** An example link and the short form wanted for it (D-84). */
export interface LinkExample {
  readonly url: string;
  readonly short: string;
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
    const { short, url, kinds, examples } = item as Record<string, unknown>;
    if (typeof short !== 'string' || typeof url !== 'string') return [];
    if (!/^https?:\/\//i.test(url)) return [];
    const varying = placeholders(short);
    if (varying.length === 0 || varying.some((name) => !placeholders(url).includes(name)))
      return [];
    const cleanKinds: Record<string, 'digits' | 'word'> = {};
    if (typeof kinds === 'object' && kinds !== null)
      for (const [name, kind] of Object.entries(kinds as Record<string, unknown>))
        if (kind === 'digits' || kind === 'word') cleanKinds[name] = kind;
    const cleanExamples = Array.isArray(examples)
      ? examples
          .filter(
            (example): example is LinkExample =>
              typeof example === 'object' &&
              example !== null &&
              typeof (example as Record<string, unknown>)['url'] === 'string' &&
              typeof (example as Record<string, unknown>)['short'] === 'string',
          )
          .slice(0, 2)
          .map((example) => ({ url: example.url, short: example.short }))
      : [];
    return [
      {
        short,
        url,
        ...(Object.keys(cleanKinds).length > 0 && { kinds: cleanKinds }),
        ...(cleanExamples.length > 0 && { examples: cleanExamples }),
      },
    ];
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
  /** D-105: stable, for turning a built-in off in the settings. */
  readonly id: string;
  readonly label: string;
  /** The URL shape; `{…}` parts come from the example. */
  readonly url: string;
  /** The short form it suggests. */
  readonly short: string;
  readonly kinds?: Readonly<Record<string, 'digits' | 'word'>>;
}

export const LINK_PRESETS: readonly LinkPreset[] = [
  {
    id: 'ado-work-item',
    label: 'Azure DevOps work item',
    url: 'https://dev.azure.com/{org}/{project}/_workitems/edit/{id}',
    short: 'AB#{id}',
    kinds: { org: 'word', project: 'word' },
  },
  {
    id: 'ado-pull-request',
    label: 'Azure DevOps pull request',
    url: 'https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}',
    short: 'PR {id}',
    kinds: { org: 'word', project: 'word', repo: 'word' },
  },
  {
    id: 'github-issue',
    label: 'GitHub issue',
    url: 'https://github.com/{owner}/{repo}/issues/{n}',
    short: '{repo}#{n}',
    kinds: { owner: 'word', repo: 'word' },
  },
  {
    id: 'github-pull-request',
    label: 'GitHub pull request',
    url: 'https://github.com/{owner}/{repo}/pull/{n}',
    short: '{repo}!{n}',
    kinds: { owner: 'word', repo: 'word' },
  },
  {
    id: 'jira-issue',
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
  if (examples.every((example) => shortFormOf(example.url, compiled) === example.short.trim()))
    return { pattern, ambiguous };
  // D-105: with two examples, one part that changes (a number or a word, like a repository's
  // name) between fixed text in both the short form and the link.
  const between = second ? inferBetween(first, second) : null;
  if (between) return { pattern: between, ambiguous: false };
  // D-111: or two parts that change, with fixed text between them (`{name}-PR-{id}`).
  const two = second ? inferTwoParts(first, second) : null;
  if (two) return { pattern: two, ambiguous: false };
  return { pattern, ambiguous: true, problem: 'The examples don’t follow one pattern.' };
}

const WORD_CHAR = /[A-Za-z0-9]/;

/** The longest common start of two texts, ending where a word starts (so it never cuts one). */
function commonStart(a: string, b: string): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  while (
    at > 0 &&
    WORD_CHAR.test(a[at - 1] ?? '') &&
    (WORD_CHAR.test(a[at] ?? '') || WORD_CHAR.test(b[at] ?? ''))
  )
    at--;
  return at;
}

/** The longest common end of two texts, starting where a word ends. */
function commonEnd(a: string, b: string, start: number): number {
  let at = 0;
  while (
    at < a.length - start &&
    at < b.length - start &&
    a[a.length - 1 - at] === b[b.length - 1 - at]
  )
    at++;
  while (
    at > 0 &&
    WORD_CHAR.test(a[a.length - at] ?? '') &&
    (WORD_CHAR.test(a[a.length - 1 - at] ?? '') || WORD_CHAR.test(b[b.length - 1 - at] ?? ''))
  )
    at--;
  return at;
}

/** The part that differs between two texts, and the fixed text around it. */
function split(a: string, b: string): { head: string; tail: string; one: string; two: string } {
  const start = commonStart(a, b);
  const end = commonEnd(a, b, start);
  return {
    head: a.slice(0, start),
    tail: a.slice(a.length - end),
    one: a.slice(start, a.length - end),
    two: b.slice(start, b.length - end),
  };
}

function inferBetween(first: LinkExample, second: LinkExample): LinkPattern | null {
  const short = split(first.short.trim(), second.short.trim());
  const url = split(first.url.trim(), second.url.trim());
  if (short.one === '' || short.two === '') return null;
  if (url.one !== short.one || url.two !== short.two) return null;
  const digits = /^\d+$/.test(short.one) && /^\d+$/.test(short.two);
  const kind = digits ? 'digits' : 'word';
  const whole = new RegExp(`^${KIND_SOURCE[kind]}$`);
  if (!whole.test(short.one) || !whole.test(short.two)) return null;
  const name = digits ? 'id' : 'name';
  const pattern: LinkPattern = {
    short: `${short.head}{${name}}${short.tail}`,
    url: `${url.head}{${name}}${url.tail}`,
    kinds: { [name]: kind },
  };
  const compiled = compileLinkPatterns([pattern]);
  return [first, second].every(
    (example) => shortFormOf(example.url, compiled) === example.short.trim(),
  )
    ? pattern
    : null;
}

/**
 * D-111: two examples whose short forms differ in two places with fixed text between them, each
 * changing part also in the link: `unicorn-api-PR-45` and `platform-PR-12` from their pull
 * request links give `{name}-PR-{id}` for `…/_git/{name}/pullrequest/{id}`. Null when they don't.
 */
function inferTwoParts(first: LinkExample, second: LinkExample): LinkPattern | null {
  const one = first.short.trim();
  const two = second.short.trim();
  const start = commonStart(one, two);
  const end = commonEnd(one, two, start);
  const head = one.slice(0, start);
  const tail = one.slice(one.length - end);
  const a = one.slice(start, one.length - end);
  const b = two.slice(start, two.length - end);
  // The longest fixed text inside both, with a changing part on each side of it.
  let middle: { text: string; at: number; atOther: number } | null = null;
  for (let size = Math.min(a.length, b.length) - 2; size >= 2 && !middle; size--)
    for (let at = 1; at + size < a.length; at++) {
      const text = a.slice(at, at + size);
      if (text.trim().length < 2) continue;
      const atOther = b.indexOf(text, 1);
      if (atOther > 0 && atOther + size < b.length) {
        middle = { text, at, atOther };
        break;
      }
    }
  if (!middle) return null;
  const parts = [
    [a.slice(0, middle.at), b.slice(0, middle.atOther)],
    [a.slice(middle.at + middle.text.length), b.slice(middle.atOther + middle.text.length)],
  ] as const;
  const kinds = parts.map(([x, y]) => (/^\d+$/.test(x) && /^\d+$/.test(y) ? 'digits' : 'word'));
  if (
    parts.some(([x, y], index) => {
      const whole = new RegExp(`^${KIND_SOURCE[kinds[index] ?? 'word']}$`);
      return !whole.test(x) || !whole.test(y);
    })
  )
    return null;
  const names =
    kinds[0] === kinds[1]
      ? kinds[0] === 'digits'
        ? ['id', 'id2']
        : ['name', 'name2']
      : kinds.map((kind) => (kind === 'digits' ? 'id' : 'name'));
  /** The link with the two parts named: the second's last place, then the first's before it. */
  const template = (url: string, firstPart: string, secondPart: string): string | null => {
    const second = url.lastIndexOf(secondPart);
    if (second < 0) return null;
    const first = url.lastIndexOf(firstPart, second - 1);
    if (first < 0 || first + firstPart.length > second) return null;
    return (
      url.slice(0, first) +
      `{${names[0]}}` +
      url.slice(first + firstPart.length, second) +
      `{${names[1]}}` +
      url.slice(second + secondPart.length)
    );
  };
  const url = template(first.url.trim(), parts[0][0], parts[1][0]);
  if (!url || url !== template(second.url.trim(), parts[0][1], parts[1][1])) return null;
  const pattern: LinkPattern = {
    short: `${head}{${names[0]}}${middle.text}{${names[1]}}${tail}`,
    url,
    kinds: { [names[0] ?? 'name']: kinds[0] ?? 'word', [names[1] ?? 'id']: kinds[1] ?? 'word' },
  };
  const compiled = compileLinkPatterns([pattern]);
  return [first, second].every(
    (example) => shortFormOf(example.url, compiled) === example.short.trim(),
  )
    ? pattern
    : null;
}

/**
 * NOTE-07, D-105: a short form needs fixed text before or after what changes (`AB#`, `-repo`,
 * `dx:`), or ordinary words in lists and notes would become links. The problem, or null.
 */
export function fixedPartProblem(pattern: LinkPattern): string | null {
  // D-111: fixed text before, between (two changing parts) or after the changing parts.
  const fixed = (text: string): boolean => text.trim().length >= 2;
  return pattern.short.split(PLACEHOLDER).some((text, index) => index % 2 === 0 && fixed(text))
    ? null
    : 'The short form needs fixed text before or after the part that changes, or ordinary words would become links.';
}

/** D-105: a short form to suggest when one has no fixed part: the site's initials and a colon. */
export function suggestShortForm(url: string, short: string): string {
  let host: string;
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    host = '';
  }
  const labels = host.split('.').filter((label) => label !== '' && label !== 'www');
  if (labels.length > 1 && /^(com|org|net|io|ge|dev|app)$/.test(labels.at(-1) ?? '')) labels.pop();
  const initials =
    labels
      .map((label) => label[0] ?? '')
      .join('')
      .toLowerCase() || 'go';
  return `${initials.slice(0, 3)}:${short.trim()}`;
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
const builtIn = (presets: readonly LinkPreset[]): CompiledPattern[] =>
  compileLinkPatterns(
    presets.map((preset) => ({
      short: preset.short,
      url: preset.url,
      kinds: Object.fromEntries(
        placeholders(preset.url).map((name) => [name, preset.kinds?.[name] ?? 'digits'] as const),
      ),
    })),
  );
let BUILT_IN = builtIn(LINK_PRESETS);

/** D-105: the built-in recognizers turned off in Settings → Links (by preset id). */
export function setBuiltInLinksOff(off: readonly string[]): void {
  BUILT_IN = builtIn(LINK_PRESETS.filter((preset) => !off.includes(preset.id)));
  version++;
}

/** D-105: how a built-in reads, as an example (`PR 42`, `AB#1234`, `repo#12`). */
export function presetSample(preset: LinkPreset): string {
  return fill(
    preset.short,
    Object.fromEntries(
      placeholders(preset.short).map((name) => [
        name,
        preset.kinds?.[name] === 'word' ? (name === 'key' ? 'KEY' : name) : '42',
      ]),
    ),
  );
}

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

/**
 * D-105: the links a text will show once saved, for chips while it is typed (the composer, the
 * capture popup): a URL a pattern or a built-in knows, as its short form, and typed short forms.
 */
export function knownLinks(text: string): { readonly label: string; readonly href: string }[] {
  const links: { label: string; href: string }[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>()]+/gi)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    const label = shortFormOf(url, active) ?? shortFormOf(url, BUILT_IN);
    if (label) links.push({ label, href: url });
  }
  for (const link of findShortForms(text, active))
    links.push({ label: link.text, href: link.href });
  return links.filter(
    (link, index) => links.findIndex((other) => other.label === link.label) === index,
  );
}
