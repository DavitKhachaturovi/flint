/**
 * AGENT-02 (D-185 Q11): help at every level, each with examples and "See also", and `flint help
 * agents`, a short guide for an agent that hasn't got the Flint skill (AGENT-04).
 */
import { GLOBAL_OPTIONS, type OptionSpec } from './args.js';
import { COMMANDS, optionsOf, verbsOf, type Command } from './commands.js';

const NOUN_SUMMARY: Record<string, string> = {
  task: 'Tasks: add, edit, done, undone, pin, unpin, move, snooze, delete',
  list: 'Task lists: add, rename, move, duplicate, convert, archive-done, delete',
  note: 'Notes: add (also --quick), append, replace, keep, delete',
  group: 'Groups in the sidebar: add, rename, add-list, remove-list, move, delete',
  links: 'Link patterns (Settings → Links): list, add, edit, delete',
};

const pad = (text: string, width: number): string =>
  text.length >= width ? `${text}  ` : text.padEnd(width);

function optionLines(options: readonly OptionSpec[]): string[] {
  return options.map((option) => {
    const name = `${option.short ? `-${option.short}, ` : ''}--${option.name}${option.value ? ` ${option.value}` : ''}`;
    return `  ${pad(name, 26)}${option.help}`;
  });
}

const examples = (lines: readonly string[]): string[] => [
  'Examples:',
  ...lines.map((line) => `  ${line}`),
];
const seeAlso = (lines: readonly string[]): string[] => [`See also: ${lines.join(', ')}`];

const EXIT_CODES = [
  'Exit codes: 0 done; 1 usage; 2 not found, ambiguous, bad time or invalid input; 3 Flint not',
  'running (--no-start), not installed or not answering; 4 refused (agents off, read-only, paused,',
  'too large); 5 internal error.',
];

/** `flint --help`. */
export function topHelp(): string[] {
  const single = COMMANDS.filter((command) => command.words.length === 1);
  return [
    'flint: find, read and change your Flint lists, notes and tasks from a terminal or an AI agent.',
    "Flint does the work; it starts in the tray if it isn't running.",
    '',
    'Usage: flint <command> [options]      (flint alone shows the overview)',
    '',
    'Commands:',
    ...single
      .filter((command) => command.words[0] !== 'status')
      .map((command) => `  ${pad(command.words[0] ?? '', 26)}${command.summary}`),
    ...Object.entries(NOUN_SUMMARY).map(
      ([noun, summary]) => `  ${pad(`${noun} <verb>`, 26)}${summary}`,
    ),
    `  ${pad('status', 26)}Version, read-only, paused, limits`,
    `  ${pad('mcp', 26)}Run the MCP server on stdio (for Claude, Cursor, VS Code…)`,
    `  ${pad('help agents', 26)}A short guide for AI agents`,
    '',
    'Options for every command:',
    ...optionLines(GLOBAL_OPTIONS),
    '',
    ...EXIT_CODES,
    '',
    ...examples([
      'flint add "Fix login loop" --list Backend --priority high --remind "tomorrow 9:00"',
      'flint find login --json',
      'flint read "Meeting notes" --outline',
    ]),
    '',
    ...seeAlso(['flint <command> --help', 'flint task --help', 'flint help agents']),
  ];
}

/** `flint task --help`. */
export function nounHelp(noun: string): string[] {
  const verbs = verbsOf(noun);
  return [
    NOUN_SUMMARY[noun] ?? noun,
    '',
    `Usage: flint ${noun} <verb> [options]`,
    '',
    'Verbs:',
    ...verbs.map((command) => `  ${pad(command.words[1] ?? '', 16)}${command.summary}`),
    '',
    ...examples(verbs.slice(0, 3).map((command) => command.examples[0] ?? '')),
    '',
    ...seeAlso([`flint ${noun} <verb> --help`, 'flint --help']),
  ];
}

/** `flint task add --help`. */
export function commandHelp(command: Command): string[] {
  return [
    command.summary,
    '',
    `Usage: flint ${command.usage}`,
    ...(command.details ? ['', ...command.details] : []),
    '',
    'Options:',
    ...optionLines(optionsOf(command)),
    `  ${pad('--json, --as, --no-start, --dev', 26)}As for every command (flint --help)`,
    '',
    ...examples(command.examples),
    '',
    ...seeAlso(command.seeAlso),
  ];
}

/** `flint mcp --help`. */
export function mcpHelp(): string[] {
  return [
    "Run Flint's MCP server on stdio: six tools (flint_find, flint_read, flint_create, flint_update,",
    'flint_delete, flint_link_patterns). An MCP client starts it; Flint starts on the first tool call.',
    '',
    'Usage: flint mcp',
    '',
    ...examples([
      'claude mcp add --scope user flint -- flint mcp',
      '{"mcpServers": {"flint": {"command": "flint", "args": ["mcp"]}}}',
    ]),
    '',
    ...seeAlso(['flint help agents', 'Flint → Settings → AI agents']),
  ];
}

/** `flint help agents`: how an agent should use Flint (AGENT-04's rules, short). */
export function agentsGuide(): string[] {
  return [
    'Flint for AI agents: the flint command (or the MCP tools, `flint mcp`) runs every action',
    "through the Flint app on this PC. Never edit Flint's markdown files directly.",
    '',
    '1. Find first: `flint --json` is the overview (lists, notes, groups, Today, reminders, now);',
    '   `flint find <words> --json` searches. Every result carries IDs.',
    '2. Act by ID: names must be exact; several matches is `ambiguous`, none is `not_found`, with',
    '   candidates or suggestions listed. Flint never guesses on a change: pick an ID and retry.',
    '3. Read in parts: `flint read <note> --outline`, then `--lines 40:120`; lists are paged',
    '   (--limit, --offset, --status). Long answers say `truncated` and how to read on.',
    '4. Edit notes with `flint note append` or `flint note replace --find … --with …`, not by',
    '   resending the whole note.',
    '5. Use `--literal` and the explicit flags (--list, --priority, --remind, --pin) instead of',
    '   capture shorthand; `--body -` / `--text -` read stdin; `--json-input -` takes a batch in',
    "   the MCP tools' JSON shape (a batch is all or nothing).",
    '6. Times: "tomorrow 9:00", "fri 14", "in 2h" or ISO 2026-11-14T09:00; `none` clears.',
    '   Every --json answer has `now`. Snooze is `flint task snooze <id> <time>`.',
    "7. Limits: too_large means split the work; paused and read_only are the user's to lift.",
    '',
    ...EXIT_CODES,
    '',
    ...seeAlso(['flint --help', 'flint <command> --help']),
  ];
}
