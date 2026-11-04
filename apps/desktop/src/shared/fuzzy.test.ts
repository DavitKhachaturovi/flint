import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy.js';

const order = (query: string, texts: readonly string[]): string[] =>
  texts
    .map((text) => ({ text, match: fuzzyMatch(query, text) }))
    .filter((item) => item.match !== null)
    .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
    .map((item) => item.text);

describe('NAV-01, D-106: the palette matches', () => {
  it('a piece of the text, best at a word start; every word of the query', () => {
    expect(fuzzyMatch('dns', 'Ask Alex about the DNS change')?.indices).toEqual([19, 20, 21]);
    expect(order('change', ['Exchange rates', 'DNS change', 'Changelog'])).toEqual([
      'Changelog',
      'DNS change',
      'Exchange rates',
    ]);
    expect(fuzzyMatch('alex dns', 'Ask Alex about the DNS change')).not.toBeNull();
    expect(fuzzyMatch('alex ftp', 'Ask Alex about the DNS change')).toBeNull();
  });

  it('one word as its letters in order, word starts first; not letters scattered anywhere', () => {
    expect(order('ofl', ['Open Flint folder', 'Show the outline', 'Interface size'])).toEqual([
      'Open Flint folder',
    ]);
    expect(fuzzyMatch('snp', 'Snapshots')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Snapshots')).toBeNull();
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });
});
