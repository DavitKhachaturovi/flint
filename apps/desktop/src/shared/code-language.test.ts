import { describe, expect, it } from 'vitest';
import { codeLanguage } from './code-language.js';

describe('code card labels (D-79)', () => {
  it('uses the fence language when there is one', () => {
    expect(codeLanguage('anything', 'YAML')).toBe('yaml');
  });

  it('names what unlabelled code looks like', () => {
    expect(codeLanguage('{"a": 1}', '')).toBe('json');
    expect(
      codeLanguage(
        'System.NullReferenceException: x\n   at A.B() in C:\\a.cs:line 4\n   at C.D() in C:\\b.cs:line 9',
        '',
      ),
    ).toBe('stack trace');
    expect(codeLanguage('services:\n  web:\n    image: nginx\n    ports:\n      - 80', '')).toBe(
      'yaml',
    );
    expect(codeLanguage('<config>\n  <a/>\n</config>', '')).toBe('xml');
    expect(codeLanguage('SELECT id FROM tasks WHERE done = 0', '')).toBe('sql');
    expect(codeLanguage('$ npm run build\n$ npm test', '')).toBe('shell');
    expect(codeLanguage('Get-ChildItem C:\\ | Where-Object Length', '')).toBe('powershell');
    expect(codeLanguage('def main():\n    print(1)', '')).toBe('python');
    expect(codeLanguage('using System;\nnamespace Flint;', '')).toBe('c#');
    expect(codeLanguage('const a = (x) => x + 1;', '')).toBe('typescript');
    expect(codeLanguage('just some words', '')).toBe('code');
  });
});
