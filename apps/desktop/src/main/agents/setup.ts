import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zipFolder } from '../storage/zip.js';

/**
 * AGENT-03, AGENT-04 (D-185): connecting apps to Flint and installing the skill. Everything
 * generated uses the full path of `flint.exe`, so it works where PATH wasn't changed (Q14).
 */

export interface SetupPaths {
  /** The installed build's `resources` folder (`process.resourcesPath`), or null in development. */
  readonly resources: string | null;
  /** The development build's app folder (`apps/desktop`), for `apps/cli/dist/flint.cjs`. */
  readonly appPath: string;
  /** Flint's app data (the `.mcpb` is written there before it is opened). */
  readonly userData: string;
  /** The skill's source folder (`resources/skill/flint`). */
  readonly skillSource: string;
  readonly version: string;
}

export interface ServerCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** The MCP server's name in the apps' settings. */
  readonly name: string;
}

/** How an app starts Flint's MCP server: `flint.exe mcp`, or node and the bundle in development. */
export function serverCommand(paths: SetupPaths): ServerCommand {
  if (paths.resources)
    return { command: join(paths.resources, 'bin', 'flint.exe'), args: ['mcp'], name: 'flint' };
  return {
    command: 'node',
    args: [join(paths.appPath, '..', 'cli', 'dist', 'flint.cjs'), 'mcp', '--dev'],
    name: 'flint-dev',
  };
}

/** The CLI's own path (what Settings shows for PATH, Q14). */
export function cliPath(paths: SetupPaths): string {
  const server = serverCommand(paths);
  return server.command === 'node' ? (server.args[0] ?? '') : server.command;
}

/** Always quoted (D-185 security review): a path with `&`, `^` or `%` must stay one argument. */
const quote = (text: string): string => `"${text.replace(/"/g, '\\"')}"`;

/** Claude Code: `claude mcp add --scope user flint -- "<path>\flint.exe" mcp`. */
export function claudeCodeCommand(paths: SetupPaths): string {
  const server = serverCommand(paths);
  return `claude mcp add --scope user ${server.name} -- ${[server.command, ...server.args].map(quote).join(' ')}`;
}

/** Copy setup: the `mcpServers` JSON most apps take (Claude Desktop's, Cursor's `mcp.json`). */
export function setupJson(paths: SetupPaths, app: 'claude-desktop' | 'cursor' | 'vscode'): string {
  const server = serverCommand(paths);
  const entry = { command: server.command, args: server.args };
  // VS Code's mcp.json uses "servers" with a type.
  const config =
    app === 'vscode'
      ? { servers: { [server.name]: { type: 'stdio', ...entry } } }
      : { mcpServers: { [server.name]: entry } };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Cursor's install link: the server's JSON, base64, in the query (Cursor's docs). */
export function cursorLink(paths: SetupPaths): string {
  const server = serverCommand(paths);
  const config = Buffer.from(
    JSON.stringify({ command: server.command, args: server.args }),
    'utf8',
  ).toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(server.name)}&config=${encodeURIComponent(config)}`;
}

/** VS Code's install link: the URL-encoded JSON with the name (VS Code's docs). */
export function vscodeLink(paths: SetupPaths): string {
  const server = serverCommand(paths);
  const config = { name: server.name, type: 'stdio', command: server.command, args: server.args };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * Add to Claude Desktop: an MCP bundle (`.mcpb`, a zip with `manifest.json`) whose server is the
 * installed `flint.exe mcp` by its full path; opening it shows Claude Desktop's install dialog.
 */
export async function writeMcpb(paths: SetupPaths, icon: string | null): Promise<string> {
  const server = serverCommand(paths);
  const folder = join(paths.userData, 'mcpb');
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const manifest = {
    manifest_version: '0.3',
    name: server.name,
    display_name: server.name === 'flint' ? 'Flint' : 'Flint (development)',
    version: paths.version.replace(/[^0-9A-Za-z.+-]/g, ''),
    description:
      'Your Flint lists, notes and tasks: find, read, add, change and complete them. Runs on this PC through the Flint app.',
    long_description:
      'Flint is a keyboard-first notes and tasks app. With AI agents turned on in Flint (Settings → AI agents), Claude can find and read your lists and notes, add tasks with reminders, edit notes, and more. Changes show in Flint at once and can be undone there.',
    author: { name: 'Davit Khachaturovi', url: 'https://flintnotes.app' },
    homepage: 'https://flintnotes.app',
    license: 'MIT',
    ...(icon && { icon: 'icon.png' }),
    // A "binary" bundle must carry its executable; this one is a tiny launcher (Claude Desktop runs
    // Node itself) that starts the installed flint.exe by its full path (D-185, MCPB spec 0.3).
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] },
    },
    tools: [
      {
        name: 'flint_find',
        description: 'Find tasks, lists, notes and groups; with no query, an overview.',
      },
      { name: 'flint_read', description: 'Read lists, notes and tasks (long notes in parts).' },
      { name: 'flint_create', description: 'Add tasks, subtasks, lists, notes and groups.' },
      { name: 'flint_update', description: 'Edit, complete, move, pin and remind; edit notes.' },
      { name: 'flint_delete', description: 'Move tasks, lists, notes and groups to Trash.' },
      { name: 'flint_link_patterns', description: 'List and edit link patterns.' },
    ],
    compatibility: { platforms: ['win32'], runtimes: { node: '>=18.0.0' } },
  };
  await writeFile(join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(join(folder, 'server'), { recursive: true });
  await writeFile(join(folder, 'server', 'index.js'), launcher(server));
  if (icon) await copyFile(icon, join(folder, 'icon.png'));
  const out = join(paths.userData, `${manifest.display_name}.mcpb`);
  await zipFolder(folder, out, '');
  await rm(folder, { recursive: true, force: true });
  return out;
}

/** The bundle's launcher: runs Flint's MCP server with the client's stdio, and says so if it's gone. */
export function launcher(server: ServerCommand): string {
  return [
    "'use strict';",
    '// Flint (AGENT-03): starts the installed flint.exe as the MCP server, passing stdio through.',
    "const { spawn } = require('node:child_process');",
    `const command = ${JSON.stringify(server.command)};`,
    `const args = ${JSON.stringify(server.args)};`,
    // The 1.8.0 preview: with stdio 'inherit', a child on Windows answered only once stdin closed,
    // so Claude Desktop gave up; the streams are copied explicitly instead.
    "const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });",
    'process.stdin.pipe(child.stdin);',
    'child.stdout.pipe(process.stdout);',
    "child.on('error', () => {",
    "  process.stderr.write('Flint is not installed at ' + command + '. Install Flint, then add it again.\\n');",
    '  process.exit(3);',
    '});',
    // What happened shows in the app's MCP log (its stderr), so a failure can be seen.
    "process.stdin.on('end', () => process.stderr.write('Flint launcher: the app closed the connection.\\n'));",
    "child.on('exit', (code) => {",
    "  process.stderr.write('Flint launcher: flint.exe mcp ended with code ' + code + '.\\n');",
    '  process.exit(code === null ? 0 : code);',
    '});',
    '',
  ].join('\n');
}

/** The skill's version, from its `SKILL.md` frontmatter (`metadata.version`). */
export async function skillVersion(folder: string): Promise<string | null> {
  const text = await readFile(join(folder, 'SKILL.md'), 'utf8').catch(() => null);
  return text ? (/^\s*version:\s*"?([^"\s]+)"?\s*$/m.exec(text)?.[1] ?? null) : null;
}

/** Where Claude Code finds personal skills: `~/.claude/skills/flint/`. */
export function claudeCodeSkillFolder(home = homedir()): string {
  return join(home, '.claude', 'skills', 'flint');
}

/** A copy Flint installed carries this marker file, so Flint never touches one it didn't. */
const MARKER = '.installed-by-flint';

export async function installedSkill(
  home = homedir(),
): Promise<{ readonly version: string | null; readonly ours: boolean } | null> {
  const folder = claudeCodeSkillFolder(home);
  const version = await skillVersion(folder);
  if (version === null) return null;
  const ours = await readFile(join(folder, MARKER)).then(
    () => true,
    () => false,
  );
  return { version, ours };
}

/** Install for Claude Code: copies the skill's files (refuses to replace a skill Flint didn't install). */
export async function installSkill(
  source: string,
  home = homedir(),
): Promise<'installed' | 'not-ours'> {
  const current = await installedSkill(home);
  if (current && !current.ours) return 'not-ours';
  const folder = claudeCodeSkillFolder(home);
  await mkdir(folder, { recursive: true });
  for (const name of ['SKILL.md', 'reference.md'])
    await copyFile(join(source, name), join(folder, name));
  await writeFile(
    join(folder, MARKER),
    'Installed by Flint (Settings → AI agents). Flint updates this copy.\n',
  );
  return 'installed';
}

/** AGENT-04: at start, a copy Flint installed is updated when Flint's is newer. */
export async function updateInstalledSkill(source: string, home = homedir()): Promise<boolean> {
  const current = await installedSkill(home);
  if (!current?.ours) return false;
  // By content, not only the version: a fix to the skill within a version reaches the copy too
  // (found on the 1.8.0 preview).
  const folder = claudeCodeSkillFolder(home);
  let same = true;
  for (const name of ['SKILL.md', 'reference.md']) {
    const [mine, theirs] = await Promise.all([
      readFile(join(source, name), 'utf8').catch(() => null),
      readFile(join(folder, name), 'utf8').catch(() => null),
    ]);
    if (mine !== null && mine !== theirs) same = false;
  }
  if (same) return false;
  await installSkill(source, home);
  return true;
}

/** Save for claude.ai: the skill folder as a zip with `flint/` at its top (claude.ai's rule). */
export async function saveSkillZip(source: string, out: string): Promise<void> {
  await zipFolder(source, out, 'flint');
}
