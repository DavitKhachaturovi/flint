import { describe, expect, it } from 'vitest';
import { readFixture } from '../../test/fixtures.js';
import { allTasks, documentLines, parseDocument, serializeDocument } from './document.js';
import { duplicateIdsToReplace, generateId } from './ids.js';
import { ensureFlintHeader, prepareForSave, setFrontmatterValues } from './save.js';

const NOW = { year: 2026, month: 10, day: 29, hour: 14, minute: 30, second: 0 };

/** Deterministic randomness for tests. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('generateId', () => {
  it('makes 4-character lowercase base-36 IDs', () => {
    expect(generateId(() => false)).toMatch(/^[a-z0-9]{4}$/);
  });

  it('retries on collisions and grows only when 4 characters keep colliding', () => {
    expect(generateId((id) => id === '0000', sequence(0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5))).toBe(
      'iiii',
    );
    expect(generateId((id) => id.length < 5, Math.random)).toMatch(/^[a-z0-9]{5}$/);
  });
});

describe('duplicateIdsToReplace (D-23)', () => {
  it('lets the older file keep shared IDs', () => {
    const result = duplicateIdsToReplace([
      { file: 'Unicorn - Copy.md', created: 200, ids: ['a1', 'b2', 'c3'] },
      { file: 'Unicorn.md', created: 100, ids: ['a1', 'b2'] },
    ]);
    expect(result).toEqual(new Map([['Unicorn - Copy.md', new Set(['a1', 'b2'])]]));
  });

  it('breaks equal creation times by path, and handles two files claiming id: inbox', () => {
    const result = duplicateIdsToReplace([
      { file: 'b.md', created: 1, ids: ['inbox'] },
      { file: 'a.md', created: 1, ids: ['inbox'] },
    ]);
    expect(result).toEqual(new Map([['b.md', new Set(['inbox'])]]));
  });
});

describe('prepareForSave (docs/04 §3, D-28)', () => {
  const text = readFixture('hand-edited.md');
  const document = parseDocument(text);
  const taken = new Set(['dup1', 'unc1', 'two2', 'last']);
  const result = prepareForSave(document, { now: NOW, isTaken: (id) => taken.has(id) });
  const saved = serializeDocument(result.document);

  it('gives every task without an ID, or with a duplicate one, a new unique ID', () => {
    const ids = [...allTasks(parseDocument(saved))].map(({ task }) => task.line.fields.id?.value);
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [from, to] of result.renamed) {
      expect(from.startsWith('~')).toBe(true);
      expect(taken.has(to)).toBe(false);
    }
  });

  it('keeps the first copy of a duplicated ID', () => {
    expect(saved).toContain('- [ ] Copy-pasted task [id:: dup1]\n');
    expect(saved.match(/\[id:: dup1\]/g)).toHaveLength(1);
  });

  it('stamps completion on tasks checked outside Flint', () => {
    expect(saved).toMatch(
      /- \[x\] Checked by hand above the heading, no completion field \[completion:: 2026-10-29T14:30\] \[id:: [a-z0-9]{4}\]\n/,
    );
  });

  it('changes only the lines that needed it', () => {
    const before = documentLines(document);
    const after = documentLines(result.document);
    const changed = after.filter((line, index) => line.text !== before[index]?.text);
    expect(after).toHaveLength(before.length);
    // Task without id, second copy, hand-checked, invalid-fields task, mid-line fields task, empty task.
    expect(changed).toHaveLength(6);
  });

  it('is a no-op for a file that has everything', () => {
    const canonical = readFixture('flint-canonical.md');
    const unchanged = prepareForSave(parseDocument(canonical), { now: NOW, isTaken: () => false });
    expect(serializeDocument(unchanged.document)).toBe(canonical);
    expect(unchanged.renamed.size).toBe(0);
  });

  it('replaces IDs an older file also has (D-23)', () => {
    const copy = parseDocument('- [ ] a [id:: a1b2]\n- [ ] b [id:: c3d4]\n');
    const { document: replaced, renamed } = prepareForSave(copy, {
      now: NOW,
      isTaken: () => false,
      replaceIds: new Set(['a1b2']),
    });
    expect([...renamed.keys()]).toEqual(['a1b2']);
    expect(serializeDocument(replaced)).toMatch(
      /^- \[ \] a \[id:: (?!a1b2)[a-z0-9]{4}\]\n- \[ \] b \[id:: c3d4\]\n$/,
    );
  });
});

describe('Flint header (D-23)', () => {
  it('adds a header to an unheadered note without touching the rest', () => {
    const text = readFixture('note-unheadered.md');
    const saved = serializeDocument(ensureFlintHeader(parseDocument(text), 'n4d8'));
    expect(saved).toBe(`---\nflint: 1\nid: n4d8\nmode: note\n---\n${text}`);
  });

  it('adds missing keys inside existing frontmatter and keeps other keys byte-for-byte', () => {
    const text = '---\r\ntags:\r\n  - work\r\naliases: [x]\r\n---\r\nbody\r\n';
    const saved = serializeDocument(ensureFlintHeader(parseDocument(text), 'n4d8'));
    expect(saved).toBe(
      '---\r\ntags:\r\n  - work\r\naliases: [x]\r\nflint: 1\r\nid: n4d8\r\nmode: note\r\n---\r\nbody\r\n',
    );
  });

  it('keeps an existing mode and version', () => {
    const text = '---\nmode: tasks\nflint: 1\n---\n';
    expect(serializeDocument(ensureFlintHeader(parseDocument(text), 'x1y2'))).toBe(
      '---\nmode: tasks\nflint: 1\nid: x1y2\n---\n',
    );
  });

  it('changes mode in place (LIST-04)', () => {
    const text = '---\nflint: 1\nid: l7c2\nmode: tasks # keep\n---\n- [ ] a\n';
    const document = setFrontmatterValues(parseDocument(text), { mode: 'note' });
    expect(serializeDocument(document)).toBe('---\nflint: 1\nid: l7c2\nmode: note\n---\n- [ ] a\n');
    expect(document.frontmatter?.mode).toBe('note');
  });
});
