import { describe, expect, it } from 'vitest';
import { classifyPaste } from './paste.js';
import { traceLineKinds } from './trace.js';

const lines = (text: string): string[] => text.split('\n');

const DOTNET = `System.NullReferenceException: Object reference not set to an instance of an object.
   at TenantResolver.Resolve(HttpContext ctx) in C:\\src\\TenantResolver.cs:line 48
   at TenantMiddleware.InvokeAsync(HttpContext ctx) in C:\\src\\TenantMiddleware.cs:line 22
--- End of stack trace from previous location ---
   at Microsoft.AspNetCore.Builder.Run()`;

const JAVA = `java.lang.IllegalStateException: token expired
\tat com.dm.auth.Tokens.check(Tokens.java:41)
\tat com.dm.auth.Filter.doFilter(Filter.java:17)
Caused by: java.time.DateTimeException: bad clock
\tat java.base/java.time.Instant.now(Instant.java:273)
\t... 12 more`;

const NODE = `TypeError: Cannot read properties of undefined (reading 'id')
    at resolveTenant (/app/src/tenant.ts:48:17)
    at async handler (/app/src/server.ts:22:5)`;

const PYTHON = `Traceback (most recent call last):
  File "/app/main.py", line 12, in <module>
    run()
  File "/app/main.py", line 8, in run
    resolve(None)
KeyError: 'tenant'`;

const GO = `panic: runtime error: invalid memory address or nil pointer dereference
goroutine 1 [running]:
main.resolve(0x0)
\t/app/main.go:48 +0x1d
main.main()
\t/app/main.go:12 +0x25`;

/** As copied from a log viewer that strips the frames' indentation (e.g. the Azure portal). */
const DOTNET_FLAT = DOTNET.split('\n')
  .map((line) => line.trim())
  .join('\n');

describe('stack traces (CAP-06, UI-06, D-65)', () => {
  it.each([
    ['.NET', DOTNET],
    ['Java', JAVA],
    ['Node', NODE],
    ['Python', PYTHON],
    ['Go', GO],
    ['.NET without indentation', DOTNET_FLAT],
  ])('a %s trace is recognised as one', (_name, trace) => {
    expect(classifyPaste(trace)).toBe('stack-trace');
  });

  it('marks the exception bright and the frames dim, in every format', () => {
    expect(traceLineKinds(lines(DOTNET))).toEqual([
      'exception',
      'frame',
      'frame',
      'header',
      'frame',
    ]);
    expect(traceLineKinds(lines(JAVA))).toEqual([
      'exception',
      'frame',
      'frame',
      'exception',
      'frame',
      'header',
    ]);
    expect(traceLineKinds(lines(NODE))).toEqual(['exception', 'frame', 'frame']);
    expect(traceLineKinds(lines(PYTHON))).toEqual([
      'header',
      'frame',
      'frame',
      'frame',
      'frame',
      'exception',
    ]);
    expect(traceLineKinds(lines(GO))).toEqual([
      'exception',
      'header',
      'frame',
      'frame',
      'frame',
      'frame',
    ]);
    expect(traceLineKinds(lines(DOTNET_FLAT)).slice(0, 3)).toEqual(['exception', 'frame', 'frame']);
  });

  it('ordinary text is not a trace', () => {
    expect(classifyPaste('meet at 15:00 tomorrow\nat the office, room 3')).toBe('text');
    expect(classifyPaste('Errors happen\nthen we fix them')).toBe('text');
  });
});
