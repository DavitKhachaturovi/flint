import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = join(import.meta.dirname, 'fixtures');

export const BOM = String.fromCharCode(0xfeff);

/** Fixture files as exact text (read as UTF-8 with any BOM kept: `-text` in .gitattributes). */
export function readFixtures(): { name: string; text: string }[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, text: readFileSync(join(directory, name), 'utf8') }));
}

export function readFixture(name: string): string {
  return readFileSync(join(directory, name), 'utf8');
}

/** Variants of a fixture that real editors produce: CRLF, BOM, tabs, mixed endings. */
export function variants(text: string): { name: string; text: string }[] {
  const crlf = text.replace(/\n/g, '\r\n');
  const tabs = text.replace(/^((?: {4})+)/gm, (indent) => '\t'.repeat(indent.length / 4));
  let count = 0;
  const mixed = text.replace(/\n/g, () => (count++ % 2 === 0 ? '\r\n' : '\n'));
  return [
    { name: 'as is', text },
    { name: 'CRLF', text: crlf },
    { name: 'BOM', text: `${BOM}${text}` },
    { name: 'BOM + CRLF', text: `${BOM}${crlf}` },
    { name: 'tabs', text: tabs },
    { name: 'mixed line endings', text: mixed },
    { name: 'no final newline', text: text.replace(/\n$/, '') },
    { name: 'lone CR line endings', text: text.replace(/\n/g, '\r') },
  ];
}
