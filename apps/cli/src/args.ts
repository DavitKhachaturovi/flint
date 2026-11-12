/**
 * AGENT-02 (D-185 Q11): a small argument parser for `flint`. Options are `--name value`,
 * `--name=value` or `--name` (a switch); `--` ends the options; a lone `-` is a value (standard
 * input). An unknown option is a usage error (exit 1), never ignored.
 */
import { usageError } from './errors.js';

/** One option a command takes. */
export interface OptionSpec {
  /** Without the dashes: `list`, `no-start`. */
  readonly name: string;
  /** The value's placeholder in help (`<list>`); missing for a switch. */
  readonly value?: string;
  /** May be given more than once (collected in order). */
  readonly repeat?: boolean;
  /** A one-letter alias, without the dash (`h`). */
  readonly short?: string;
  readonly help: string;
}

export type OptionValue = string | true | readonly string[];

export interface Parsed {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, OptionValue>;
}

/** Options every command takes (help lists them once, at the top level). */
export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  { name: 'json', help: 'Print the result (or {"error": …}) as one JSON document on stdout' },
  { name: 'as', value: '<name>', help: 'The agent name Flint records (else FLINT_AGENT)' },
  { name: 'no-start', help: "Don't start Flint when it isn't running (exit 3)" },
  { name: 'dev', help: 'Talk to the development Flint' },
  { name: 'help', short: 'h', help: 'Show help' },
];

/**
 * Whether a token is an option: `--name…` or `-h`. Anything else starting with a dash (`-`, `- item`,
 * `-5`) is a value, so markdown text and negative numbers pass as they are.
 */
export const isOption = (token: string): boolean => /^--[A-Za-z]|^-[A-Za-z]$/.test(token);

/** The command words an argument list starts with, skipping global options (and their values). */
export function commandWords(argv: readonly string[]): { words: string[]; rest: string[] } {
  const words: string[] = [];
  const rest: string[] = [];
  let index = 0;
  while (index < argv.length && words.length < 2) {
    const token = argv[index] ?? '';
    if (token === '--') break;
    if (isOption(token)) {
      const spec = GLOBAL_OPTIONS.find(
        (option) => `--${option.name}` === token.split('=')[0] || `-${option.short}` === token,
      );
      // A command's own option ends the command words (`flint find --type task`).
      if (!spec) break;
      rest.push(token);
      if (spec.value !== undefined && !token.includes('=') && index + 1 < argv.length) {
        rest.push(argv[index + 1] ?? '');
        index += 1;
      }
      index += 1;
      continue;
    }
    // Only the first word, and a second one after a noun, are command words.
    if (words.length === 1 && !NOUNS.has(words[0] ?? '')) break;
    words.push(token);
    index += 1;
  }
  return { words, rest: [...rest, ...argv.slice(index)] };
}

/** Commands that take a verb (`flint task add`). `help` takes a topic (`flint help agents`). */
export const NOUNS: ReadonlySet<string> = new Set([
  'task',
  'list',
  'note',
  'group',
  'links',
  'help',
]);

/** Parses the arguments after the command words against the command's options. */
export function parseArgs(
  argv: readonly string[],
  specs: readonly OptionSpec[],
  command: string,
): Parsed {
  const all = [...GLOBAL_OPTIONS, ...specs];
  const positionals: string[] = [];
  const options = new Map<string, OptionValue>();
  let index = 0;
  const set = (spec: OptionSpec, value: string | true): void => {
    if (spec.repeat && typeof value === 'string') {
      const before = options.get(spec.name);
      options.set(spec.name, [...(Array.isArray(before) ? (before as string[]) : []), value]);
    } else if (options.has(spec.name) && spec.value !== undefined) {
      throw usageError(`--${spec.name} is given twice for \`${command}\`.`);
    } else {
      options.set(spec.name, value);
    }
  };
  while (index < argv.length) {
    const token = argv[index] ?? '';
    index += 1;
    if (token === '--') {
      positionals.push(...argv.slice(index));
      break;
    }
    if (!isOption(token)) {
      positionals.push(token);
      continue;
    }
    let name: string;
    let inline: string | undefined;
    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      name = equals === -1 ? token.slice(2) : token.slice(2, equals);
      inline = equals === -1 ? undefined : token.slice(equals + 1);
    } else {
      const short = all.find((spec) => spec.short === token.slice(1));
      if (!short) throw usageError(`Unknown option ${token} for \`${command}\`.`);
      name = short.name;
    }
    const spec = all.find((option) => option.name === name);
    if (!spec) throw usageError(`Unknown option --${name} for \`${command}\`.`);
    if (spec.value === undefined) {
      if (inline !== undefined) throw usageError(`--${name} takes no value.`);
      set(spec, true);
      continue;
    }
    if (inline !== undefined) {
      set(spec, inline);
      continue;
    }
    const value = argv[index];
    if (value === undefined || (value.startsWith('--') && isOption(value)))
      throw usageError(`--${name} needs a value: --${name} ${spec.value}.`);
    index += 1;
    set(spec, value);
  }
  return { positionals, options };
}
