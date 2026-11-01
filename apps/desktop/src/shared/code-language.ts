import { classifyPaste } from '@flint/core/shorthand';

/**
 * The label of a code card in a body (D-79): the fence's own language when it names one, else the
 * language the code looks like (`json`, `stack trace`, `yaml`, `xml`, `sql`, `shell`, `powershell`,
 * `python`, `c#`, `typescript`), else `code`. Only the label: the text is never changed.
 */
export function codeLanguage(code: string, fence: string): string {
  const named = fence.trim().toLowerCase();
  if (named !== '') return named;
  const kind = classifyPaste(code);
  if (kind === 'json') return 'json';
  if (kind === 'stack-trace') return 'stack trace';
  const lines = code.split(/\r?\n/).filter((line) => line.trim() !== '');
  const share = (pattern: RegExp): number =>
    lines.length === 0 ? 0 : lines.filter((line) => pattern.test(line)).length / lines.length;
  if (/^\s*<(\?xml|!doctype|[a-z][\w:-]*[\s>/])/i.test(code)) return 'xml';
  if (/^\s*(select|insert|update|delete|create|alter|with)\s/i.test(code)) return 'sql';
  if (/^\s*(Get|Set|New|Remove|Invoke|Start|Stop)-[A-Z]\w+|\$env:/m.test(code)) return 'powershell';
  if (/^\s*(\$ |#!\/|npm |npx |git |cd |sudo |docker |kubectl |az |curl )/m.test(code))
    return 'shell';
  if (/^\s*(def |class \w+(\(.*\))?:|import \w+$|from \w+ import )/m.test(code)) return 'python';
  if (
    /^\s*(using System|namespace \w|public (sealed |static )?(class|record|interface) )/m.test(code)
  )
    return 'c#';
  if (/^\s*(import .* from |export |const |let |function |interface \w+ \{)|=>/m.test(code))
    return 'typescript';
  if (share(/^\s*(- )?[\w.-]+:(\s|$)/) >= 0.6) return 'yaml';
  return 'code';
}
