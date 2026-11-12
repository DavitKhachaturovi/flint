/**
 * AGENT-02 (D-185 Q11): the `flint` command. Arguments → one request over the pipe → the answer
 * printed: plain text by default, one JSON document with `--json`. Never a prompt; the exit code
 * says what happened (errors.ts).
 */
import type { AgentIdentity, NowInfo } from '@flint/core/agents';
import { cliAgent } from './agent.js';
import { commandWords, NOUNS, parseArgs, type Parsed } from './args.js';
import {
  findCommand,
  fromJsonInput,
  optionsOf,
  STDIN_OPTIONS,
  verbsOf,
  type Command,
} from './commands.js';
import { EXIT, FlintError, usageError, type ErrorBody } from './errors.js';
import { agentsGuide, commandHelp, mcpHelp, nounHelp, topHelp } from './help.js';
import type { Env } from './locate.js';
import { COLOURS, PLAIN, renderError, renderResult } from './render.js';
import type { AgentSession } from './session.js';
import { runPath } from './path-entry.js';

/** The process around the CLI (tests give their own). */
export interface Io {
  readonly env: Env;
  readonly cwd: string;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  out(text: string): void;
  err(text: string): void;
  readStdin(): Promise<string>;
}

export interface ReachChoice {
  /** `--dev`. */
  readonly dev: boolean;
  /** `--no-start` or `FLINT_NO_START=1`. */
  readonly noStart: boolean;
}

export interface CliDeps {
  /** A session for this agent (main.ts: the real one, reaching Flint over its pipe). */
  readonly openSession: (agent: AgentIdentity, choice: ReachChoice) => AgentSession;
  /** `flint mcp`: runs the MCP server until stdin closes; its exit code. */
  readonly runMcp: (choice: ReachChoice) => Promise<number>;
}

/**
 * What `--json` and the MCP tools return: the result, with `now` (D-185 Q7: agents often don't
 * know today's date). A result that isn't an object is returned as it is.
 */
export function withNow(result: unknown, now: NowInfo | undefined): unknown {
  if (now === undefined || typeof result !== 'object' || result === null || Array.isArray(result))
    return result;
  return 'now' in result ? result : { ...result, now };
}

const lines = (text: readonly string[]): string => (text.length > 0 ? `${text.join('\n')}\n` : '');

/** Runs `flint` with these arguments; resolves to the exit code. */
export async function runCli(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const wantsJson = argv.includes('--json');
  const fail = (body: ErrorBody, usage?: string): number => {
    if (wantsJson) io.out(`${JSON.stringify({ error: body })}\n`);
    else {
      const style = io.stderrIsTTY && !io.env['NO_COLOR'] ? COLOURS : PLAIN;
      io.err(lines([...renderError(body, style), ...(usage ? [usage] : [])]));
    }
    return new FlintError(body).exitCode;
  };
  let command: Command | undefined;
  try {
    const { words, rest } = commandWords(argv);
    const [first, second] = words;
    const noun = first !== undefined && NOUNS.has(first) ? first : undefined;
    if (first === 'mcp') {
      const parsed = parseArgs(rest, [], 'flint mcp');
      if (parsed.options.has('help')) return print(io, mcpHelp());
      if (parsed.positionals.length > 0)
        throw usageError(`Unexpected argument "${parsed.positionals[0]}".`);
      return await deps.runMcp(choice(parsed, io.env));
    }
    // D-185 Q14: the installer's PATH step (not in the help: it is Flint's own).
    if (first === 'path')
      return await runPath(second, process.execPath, (line) => io.out(`${line}\n`));
    if (first === 'help') {
      if (second === 'agents') return print(io, agentsGuide());
      if (second !== undefined && verbsOf(second).length > 0) return print(io, nounHelp(second));
      const topic = second === undefined ? undefined : findCommand([second]);
      return print(io, topic ? commandHelp(topic) : topHelp());
    }
    if (first === undefined) {
      // `flint` alone: the overview (`flint find` without a query).
      const parsed = parseArgs(rest, [], 'flint');
      if (parsed.options.has('help')) return print(io, topHelp());
      if (parsed.positionals.length > 0)
        throw usageError(`Unknown command "${parsed.positionals[0]}".`);
      command = findCommand(['find']);
    } else if (noun !== undefined) {
      if (second === undefined || second === '-h' || second === '--help')
        return print(io, nounHelp(noun));
      command = findCommand([noun, second]);
      if (!command)
        throw usageError(
          `Unknown command "flint ${noun} ${second}". Verbs: ${verbsOf(noun)
            .map((verb) => verb.words[1])
            .join(', ')}.`,
        );
    } else {
      command = findCommand([first]);
      if (!command) throw usageError(`Unknown command "${first}". Run flint --help.`);
    }
    if (!command) throw usageError('Unknown command. Run flint --help.');
    const parsed = parseArgs(rest, optionsOf(command), `flint ${command.words.join(' ')}`);
    if (parsed.options.has('help')) return print(io, commandHelp(command));
    const args = await buildArgs(command, parsed, io);
    const json = parsed.options.get('json') === true;
    const as = parsed.options.get('as');
    const session = deps.openSession(
      cliAgent(typeof as === 'string' ? as : undefined, io.env),
      choice(parsed, io.env),
    );
    let response;
    try {
      response = await session.call(command.tool, args);
    } finally {
      session.close();
    }
    if (!response.ok) return fail(response.error);
    if (json) io.out(`${JSON.stringify(withNow(response.result, response.now))}\n`);
    else {
      const style = io.stdoutIsTTY && !io.env['NO_COLOR'] ? COLOURS : PLAIN;
      io.out(lines(renderResult(command.tool, response.result, response.now, style)));
    }
    return EXIT.ok;
  } catch (error) {
    if (error instanceof FlintError)
      return fail(
        error.body,
        error.body.code === 'usage'
          ? command
            ? `Usage: flint ${command.usage}   (flint ${command.words.join(' ')} --help)`
            : 'Usage: flint <command> [options]   (flint --help)'
          : undefined,
      );
    return fail({
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function print(io: Io, text: readonly string[]): number {
  io.out(lines(text));
  return EXIT.ok;
}

function choice(parsed: Parsed, env: Env): ReachChoice {
  return {
    dev: parsed.options.get('dev') === true,
    noStart: parsed.options.get('no-start') === true || env['FLINT_NO_START'] === '1',
  };
}

/** The tool's arguments: from `--json-input -`, or built from the arguments (stdin read for `-`). */
async function buildArgs(command: Command, parsed: Parsed, io: Io): Promise<unknown> {
  const options = new Map(parsed.options);
  const literal = options.get('literal') === true;
  const jsonInput = options.get('json-input');
  if (jsonInput !== undefined) {
    if (jsonInput !== '-')
      throw usageError('--json-input reads standard input: give --json-input -.');
    if (parsed.positionals.length > 0)
      throw usageError(
        'With --json-input -, the whole request comes from stdin: no other arguments.',
      );
    let value: unknown;
    try {
      value = JSON.parse(await io.readStdin());
    } catch {
      throw usageError("--json-input -: standard input isn't valid JSON.");
    }
    return fromJsonInput(command, value, literal);
  }
  const fromStdin = STDIN_OPTIONS.filter((name) => options.get(name) === '-');
  if (fromStdin.length > 1) throw usageError('Only one option can read standard input (-).');
  const name = fromStdin[0];
  if (name !== undefined)
    options.set(name, (await io.readStdin()).replace(/\r\n/g, '\n').replace(/\n$/, ''));
  return command.build({ positionals: parsed.positionals, options, cwd: io.cwd });
}
