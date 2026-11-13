import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeCodeCommand, cursorLink, launcher, vscodeLink, type SetupPaths } from './setup.js';

/** AGENT-03 (D-185): what Flint generates to connect apps. */

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-setup-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const installed = (): SetupPaths => ({
  resources: 'C:\\Users\\Alex\\AppData\\Local\\Programs\\flint\\resources',
  appPath: 'C:\\x',
  userData: base,
  skillSource: base,
  version: '1.8.0',
});

describe('the .mcpb launcher (found on the 1.8.0 preview)', () => {
  it('answers while stdin is still open, copying the streams itself', async () => {
    // A stand-in server: echoes each line at once, as `flint mcp` answers each request.
    const echo = join(base, 'echo.js');
    await writeFile(
      echo,
      "process.stdin.setEncoding('utf8');process.stdin.on('data',(d)=>process.stdout.write('echo:'+d));",
    );
    const script = join(base, 'launcher.js');
    await writeFile(script, launcher({ command: process.execPath, args: [echo], name: 'flint' }));
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    const answered = new Promise<string>((resolve) => {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => resolve(data));
    });
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    // The answer comes while stdin is still open (an app keeps it open for the whole session).
    expect(await answered).toBe('echo:{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    child.stdin.end();
    await new Promise((resolve) => child.on('exit', resolve));
  });

  it('says so when flint.exe is gone, with exit 3', async () => {
    const script = join(base, 'launcher.js');
    await writeFile(
      script,
      launcher({ command: join(base, 'missing.exe'), args: ['mcp'], name: 'flint' }),
    );
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => (err += data));
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(3);
    expect(err).toContain('Flint is not installed at');
  });
});

describe('setup for the other apps', () => {
  it('quotes the path in Claude Code’s command, and builds the install links', async () => {
    const paths = installed();
    expect(claudeCodeCommand(paths)).toBe(
      'claude mcp add --scope user flint -- "C:\\Users\\Alex\\AppData\\Local\\Programs\\flint\\resources\\bin\\flint.exe" "mcp"',
    );
    const cursor = new URL(cursorLink(paths));
    const config = JSON.parse(
      Buffer.from(cursor.searchParams.get('config') ?? '', 'base64').toString('utf8'),
    ) as { command: string; args: string[] };
    expect(config.args).toEqual(['mcp']);
    expect(decodeURIComponent(vscodeLink(paths).split('?')[1] ?? '')).toContain('"type":"stdio"');
    void readFile;
  });
});
