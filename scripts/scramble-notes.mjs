// Shape-only copies of a notes folder for the editor's tests (D-141 Q2, Q13). Markdown syntax,
// whitespace, line breaks, indentation and Flint's tokens stay; every letter becomes a random one
// of the same case and script (Georgian stays Georgian), every digit a random digit, URL hosts
// `*.example`, file and attachment names `note-01.md`, `image-01.png`. Deterministic for a seed.
//
// Usage: node scripts/scramble-notes.mjs <notes folder> <output folder> [--seed N]
//
// The output folder must be outside this repository: the copies are committed only after their
// owner has reviewed them. The script fails if any word of four or more letters from the notes
// (other than the fixed lists of markdown and Flint words below) survives in its output. It prints
// counts only, never note text.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const seedAt = args.indexOf('--seed');
const seed = seedAt >= 0 ? Number(args[seedAt + 1]) : 141;
const [source, target] = args.filter((_, at) => seedAt < 0 || (at !== seedAt && at !== seedAt + 1));
if (!source || !target || !Number.isInteger(seed)) {
  console.error('Usage: node scripts/scramble-notes.mjs <notes folder> <output folder> [--seed N]');
  process.exit(1);
}
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(target);
if (!relative(repository, output).startsWith('..')) {
  console.error('The output folder must be outside the repository (review the copies first).');
  process.exit(1);
}

// mulberry32: a small seeded generator, so the same notes and seed give the same copies.
let state = seed >>> 0;
function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (chars) => chars[Math.floor(random() * chars.length)];
const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, at) => String.fromCodePoint(from + at));
const two = (n) => String(n).padStart(2, '0');
const between = (low, high) => low + Math.floor(random() * (high - low + 1));

/** Same case, same script. */
const SCRIPTS = [
  { test: /[a-z]/u, letters: range(0x61, 0x7a) },
  { test: /[A-Z]/u, letters: range(0x41, 0x5a) },
  { test: /[\u10D0-\u10FF]/u, letters: range(0x10d0, 0x10f0) }, // Georgian Mkhedruli
  { test: /[\u1C90-\u1CBF]/u, letters: range(0x1c90, 0x1cb0) }, // Georgian Mtavruli
  { test: /[\u10A0-\u10CF]/u, letters: range(0x10a0, 0x10c5) }, // Georgian Asomtavruli
  { test: /[\u0430-\u045F]/u, letters: range(0x0430, 0x044f) }, // Cyrillic lower
  { test: /[\u0400-\u042F]/u, letters: range(0x0410, 0x042f) }, // Cyrillic upper
  { test: /[\u03B1-\u03C9]/u, letters: range(0x03b1, 0x03c9) }, // Greek lower
  { test: /[\u0391-\u03A9]/u, letters: range(0x0391, 0x03a9) }, // Greek upper
];
const LOWER = range(0x61, 0x7a);
const UPPER = range(0x41, 0x5a);
function letterFor(char) {
  for (const script of SCRIPTS) if (script.test.test(char)) return pick(script.letters);
  return char.toLowerCase() !== char ? pick(UPPER) : pick(LOWER);
}

// Words kept on purpose: markdown and Flint's own, never anyone's notes.
const LANGUAGES = new Set(
  'bash bat c cpp cs csharp css csv diff dockerfile go graphql html http ini java javascript js json jsonc jsx kotlin kql less log lua makefile markdown md mermaid nginx php plaintext powershell ps ps1 python py r regex ruby rust scss sh shell sql swift text toml ts tsx txt typescript vb xml yaml yml'.split(
    ' ',
  ),
);
const TAGS = new Set(
  'a abbr b br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre q s small span strong sub summary sup table tbody td th thead tr u ul'.split(
    ' ',
  ),
);
const FIELD_KEYS = new Set(['id', 'priority', 'reminder', 'today', 'completion', 'muted']);
const FRONT_KEYS = new Set(['flint', 'id', 'mode', 'tags', 'aliases', 'created', 'updated']);
const KEPT = new Set([
  ...LANGUAGES,
  ...TAGS,
  ...FIELD_KEYS,
  ...FRONT_KEYS,
  ...'high medium low true false note tasks http https file folder example attachments image video'.split(
    ' ',
  ),
]);

const notesWords = new Set();
function scrambleLetters(text) {
  return text
    .replace(/\p{L}+/gu, (word) => {
      for (let tries = 0; ; tries++) {
        const next = [...word].map(letterFor).join('');
        const lower = next.toLowerCase();
        if (next.length < 4 || (!notesWords.has(lower) && !KEPT.has(lower)) || tries > 50)
          return next;
      }
    })
    .replace(/\d/g, () => String(between(0, 9)));
}
const randomId = (length) =>
  Array.from({ length }, () => pick('abcdefghijklmnopqrstuvwxyz0123456789')).join('');
function randomDate(shape) {
  const date = `${between(2020, 2030)}-${two(between(1, 12))}-${two(between(1, 28))}`;
  if (!shape.includes('T')) return date;
  const time = `${two(between(0, 23))}:${two(between(0, 59))}`;
  return `${date}T${time}${shape.length > 16 ? `:${two(between(0, 59))}` : ''}`;
}
let attachmentCount = 0;
function attachment(link) {
  const ext = extname(link.replace(/[?#].*$/, '')).toLowerCase();
  const image = /^\.(png|jpe?g|gif|webp|bmp|svg)$/.test(ext);
  attachmentCount++;
  return `attachments/${image ? 'image' : 'file'}-${two(attachmentCount)}${ext}`;
}
function url(whole) {
  const match = /^(https?):\/\/([^/?#:]+)(:\d+)?(.*)$/i.exec(whole);
  if (!match) return scrambleLetters(whole);
  const labels = match[2].split('.');
  const host = `${labels
    .slice(0, -1)
    .map((label) => scrambleLetters(label))
    .join('.')}${labels.length > 1 ? '.' : ''}example`;
  return `${match[1].toLowerCase()}://${host}${match[3] ?? ''}${scrambleLetters(match[4])}`;
}

const TOKEN = new RegExp(
  [
    String.raw`(?<field>([\[(])(id|priority|reminder|today|completion|muted)(::[ \t]*)([^\])\n]*?)([ \t]*[\])]))`,
    String.raw`(?<date>\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?\b)`,
    String.raw`(?<time>\b(?:[01]?\d|2[0-3]):[0-5]\d\b)`,
    String.raw`(?<url>\bhttps?:\/\/[^\s)<>\]"'\x60]+)`,
    String.raw`(?<fileurl>\bfile:\/\/\/[^\s)<>\]"'\x60]+)`,
    String.raw`(?<attachment>\battachments\/[^\s)<>\]"'\x60]+)`,
    String.raw`(?<task>\[[ xX]\])`,
    // An ordered list's number shapes the list (only `1.` interrupts a paragraph in CommonMark).
    String.raw`(?<ordered>^[ \t>]*\d{1,9}[.)](?=[ \t]|$))`,
    String.raw`(?<fence>^[ \t]*(?:\x60{3,}|~{3,})[ \t]*[^\s\x60]*)`,
    String.raw`(?<tag><\/?[A-Za-z][A-Za-z0-9-]*)`,
  ].join('|'),
  'gmu',
);

function fieldValue(key, value) {
  if (key === 'id') return randomId(value.length);
  if (key === 'priority' && /^(high|medium|low)$/i.test(value)) return value;
  if ((key === 'today' || key === 'muted') && /^(true|false)$/i.test(value)) return value;
  if (key === 'reminder' || key === 'completion')
    return value.replace(/\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?/g, randomDate);
  return scrambleLetters(value);
}

function scrambleBody(text) {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    out += scrambleLetters(text.slice(last, match.index));
    last = match.index + match[0].length;
    const g = match.groups;
    const whole = match[0];
    if (g.field) {
      const [, , open, key, sep, value, close] = match;
      out += `${open}${key}${sep}${fieldValue(key, value)}${close}`;
    } else if (g.date) out += randomDate(whole);
    else if (g.time) out += `${between(0, 23)}:${two(between(0, 59))}`.padStart(whole.length, '0');
    else if (g.url) out += url(whole);
    else if (g.fileurl)
      out += `file:///C:/folder/${attachment(whole).slice('attachments/'.length)}`;
    else if (g.attachment) out += attachment(whole);
    else if (g.task || g.ordered) out += whole;
    else if (g.fence) {
      const info = /[^\s\x60~]*$/.exec(whole)[0];
      const head = whole.slice(0, whole.length - info.length);
      out += head + (LANGUAGES.has(info.toLowerCase()) ? info : scrambleLetters(info));
    } else if (g.tag) {
      const name = whole.replace(/^<\/?/, '');
      out += whole.slice(0, whole.length - name.length);
      out += TAGS.has(name.toLowerCase()) ? name : scrambleLetters(name);
    }
  }
  return out + scrambleLetters(text.slice(last));
}

function scrambleNote(text) {
  const front = /^---\r?\n([\s\S]*?\r?\n)?---(\r?\n|$)/.exec(text);
  if (!front) return scrambleBody(text);
  const lines = front[0].split(/(\r?\n)/);
  const kept = lines
    .map((line) => {
      const pair = /^([A-Za-z_][\w-]*)(:[ \t]*)(.*)$/.exec(line);
      if (!pair || !FRONT_KEYS.has(pair[1].toLowerCase()))
        return /^---$/.test(line) ? line : scrambleBody(line);
      if (pair[1] === 'id') return `${pair[1]}${pair[2]}${randomId(pair[3].length)}`;
      if (pair[1] === 'flint' || (pair[1] === 'mode' && /^(note|tasks)$/.test(pair[3])))
        return line;
      return `${pair[1]}${pair[2]}${scrambleBody(pair[3])}`;
    })
    .join('');
  return kept + scrambleBody(text.slice(front[0].length));
}

function walk(folder) {
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.') || entry.name === 'attachments') continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.toLowerCase().endsWith('.md')) found.push(path);
  }
  return found;
}

const files = walk(resolve(source));
const texts = files.map((file) => readFileSync(file, 'utf8'));
for (const text of texts)
  for (const word of text.match(/\p{L}{4,}/gu) ?? []) notesWords.add(word.toLowerCase());

const folders = new Map();
let surviving = 0;
let characters = 0;
files.forEach((file, at) => {
  const folder = dirname(relative(resolve(source), file));
  if (folder !== '.' && !folders.has(folder))
    folders.set(folder, `folder-${two(folders.size + 1)}`);
  const name = `note-${two(at + 1)}.md`;
  const path = join(output, folder === '.' ? '' : folders.get(folder), name);
  const scrambled = scrambleNote(texts[at]);
  for (const word of scrambled.matchAll(/\p{L}{4,}/gu)) {
    const lower = word[0].toLowerCase();
    if (!notesWords.has(lower) || KEPT.has(lower)) continue;
    surviving++;
    // Where, without the word: its length and the character before it.
    const before = scrambled[word.index - 1] ?? 'start';
    console.error(
      `note ${at + 1}: a ${word[0].length}-letter word after ${JSON.stringify(before)}`,
    );
  }
  characters += scrambled.length;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, scrambled);
});

console.log(
  `seed ${seed}: ${files.length} notes, ${characters} characters, ${folders.size} folders, ` +
    `${attachmentCount} attachment links; surviving words: ${surviving}`,
);
if (surviving > 0) {
  console.error('Words from the notes survived: nothing may be committed. Try another seed.');
  process.exit(2);
}
