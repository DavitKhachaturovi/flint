import { describe, expect, it } from 'vitest';
import { BOM, readFixture, readFixtures, variants } from '../../test/fixtures.js';
import {
  allTasks,
  documentLines,
  documentMode,
  formatVersion,
  isProvisionalKey,
  parseDocument,
  serializeDocument,
  type Block,
  type FlintDocument,
  type TaskNode,
} from './document.js';
import { joinLines } from './lines.js';

function titles(document: FlintDocument): string[] {
  return [...allTasks(document)].map(({ task, parent }) =>
    parent ? `  ${task.line.title}` : task.line.title,
  );
}

function otherText(block: Block): string {
  return block.kind === 'other' ? joinLines(block.lines) : '';
}

function childText(task: TaskNode): string {
  return task.children
    .map((child) => (child.kind === 'text' ? joinLines(child.lines) : `<${child.line.title}>\n`))
    .join('');
}

describe('round trip: untouched files come back byte-for-byte (docs/04 §3)', () => {
  for (const fixture of readFixtures()) {
    for (const variant of variants(fixture.text)) {
      it(`${fixture.name} (${variant.name})`, () => {
        expect(serializeDocument(parseDocument(variant.text))).toBe(variant.text);
      });
    }
  }

  it('empty file and lone BOM', () => {
    expect(serializeDocument(parseDocument(''))).toBe('');
    expect(serializeDocument(parseDocument(BOM))).toBe(BOM);
  });
});

describe('structure: the canonical Flint file (docs/04 §3)', () => {
  const document = parseDocument(readFixture('flint-canonical.md'));

  it('reads the frontmatter', () => {
    expect(document.frontmatter).toMatchObject({ flint: '1', id: 'l7c2', mode: 'tasks' });
    expect(documentMode(document)).toBe('tasks');
    expect(formatVersion(document)).toBe(1);
  });

  it('finds tasks, the subtask and the body', () => {
    expect(titles(document)).toEqual([
      'Fix null ref in tenant resolver',
      '  Add regression test',
      'Ask about staging DNS',
      'Update CI agent image',
      'Rotate service principal secret',
    ]);
    const first = document.blocks[0] as TaskNode;
    expect(first.key).toBe('k3f9');
    expect(childText(first)).toBe(
      '    Stack trace from staging:\n    ```\n    NullReferenceException at TenantResolver.Resolve(...)\n    ```\n<Add regression test>\n',
    );
  });

  it('gives the Completed heading its own block, after a blank line', () => {
    const kinds = document.blocks.map((block) =>
      block.kind === 'task' ? 'task' : block.completedHeading ? 'completed' : 'other',
    );
    expect(kinds).toEqual(['task', 'task', 'task', 'other', 'completed', 'task']);
    expect(otherText(document.blocks[3] as Block)).toBe('\n');
  });

  it('uses 4-space indentation and LF for new lines', () => {
    expect(document.indentUnit).toBe('    ');
    expect(document.eol).toBe('\n');
  });
});

describe('structure: Obsidian-edited file', () => {
  const document = parseDocument(readFixture('obsidian-edited.md'));

  it('keeps unrelated frontmatter keys and reads Flint ones', () => {
    expect(document.frontmatter?.lines).toHaveLength(9);
    expect(document.frontmatter?.id).toBe('u9n1');
  });

  it('treats cancelled items, plain bullets and numbered checkboxes as non-task content (D-22)', () => {
    expect(titles(document)).toEqual([
      'Review [[Tenant cache]] design',
      'Profile (std::move) usage in the importer',
      'Check [Vec::new] behaviour under load',
      'Call with infra',
      '  Prepare questions',
      'Fix `[priority:: high]` example in docs',
      'Upgrade Node in CI',
    ]);
    const nonTask = document.blocks
      .filter((block) => block.kind === 'other')
      .map(otherText)
      .join('');
    expect(nonTask).toContain('- [-] Old migration plan');
    expect(nonTask).toContain('    - [ ] nested under a plain bullet, not a Flint task\n');
    expect(nonTask).toContain('1. [ ] numbered checkbox, not a Flint task\n');
  });

  it('keeps deeper items in the subtask body and later parent text with the parent', () => {
    const call = [...allTasks(document)].find(
      ({ task }) => task.line.title === 'Call with infra',
    )?.task;
    expect(call?.line.fields.priority?.value).toBe('medium');
    expect(call && childText(call)).toBe(
      "<Prepare questions>\n\n    Notes after a blank line, indented less than the subtask's content, belong to the parent.\n",
    );
    const prepare = call?.children.find((child) => child.kind === 'task');
    expect(prepare && childText(prepare)).toBe(
      "        - [ ] deeper item, part of the subtask's body\n",
    );
  });

  it('reads Obsidian Tasks fields and block IDs', () => {
    const review = document.blocks.find((block) => block.kind === 'task');
    expect(review?.kind === 'task' && review.line).toMatchObject({
      blockId: 'cache-review',
      unknown: [{ key: 'due', value: '2026-11-02' }],
      fields: { priority: { value: 'high' }, id: { value: 'dcf64c' } },
    });
  });
});

describe('structure: VS Code-edited file', () => {
  const document = parseDocument(readFixture('vscode-two-space.md'));

  it('has no frontmatter, so it is a note until converted (D-23)', () => {
    expect(document.frontmatter).toBeNull();
    expect(documentMode(document)).toBe('note');
    expect(formatVersion(document)).toBeNull();
  });

  it('reads * and + markers, 2-space subtasks and lazy continuation lines', () => {
    expect(titles(document)).toEqual([
      'Write the release notes',
      '  Collect merged PRs',
      '  Ask QA for the known issues',
      'Rotate the staging certificate',
      'Clean up feature flags',
      'Task with a body after a blank line',
    ]);
    const cleanup = document.blocks[2] as TaskNode;
    expect(childText(cleanup)).toBe('lazy continuation line that belongs to the task above\n');
  });

  it('keeps a code block in the body, and the task inside it is not a task', () => {
    const last = document.blocks[3] as TaskNode;
    expect(childText(last)).toContain('{ "key": "- [ ] not a task inside a code block" }');
    expect(last.children.every((child) => child.kind === 'text')).toBe(true);
  });
});

describe('structure: hand-edited file', () => {
  const document = parseDocument(readFixture('hand-edited.md'));

  it('ignores tasks inside HTML comments, code blocks and indented code', () => {
    expect(titles(document)).not.toContain('this line, which is not a task');
    expect(titles(document).some((title) => title.includes('not a task'))).toBe(false);
  });

  it('accepts an empty task', () => {
    expect(titles(document)).toContain('');
  });

  it('gives provisional keys to missing and duplicate IDs; the first copy keeps the ID', () => {
    const keys = [...allTasks(document)].map(({ task }) => task.key);
    expect(isProvisionalKey(keys[0] ?? '')).toBe(true);
    expect(keys[1]).toBe('dup1');
    expect(isProvisionalKey(keys[2] ?? '')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives the same provisional keys when the same text is read again', () => {
    const again = parseDocument(readFixture('hand-edited.md'));
    expect([...allTasks(again)].map(({ task }) => task.key)).toEqual(
      [...allTasks(document)].map(({ task }) => task.key),
    );
  });

  it('seeds provisional keys so identical lines in different files differ', () => {
    const a = parseDocument('- [ ] same\n', { keySeed: 'a.md' });
    const b = parseDocument('- [ ] same\n', { keySeed: 'b.md' });
    expect((a.blocks[0] as TaskNode).key).not.toBe((b.blocks[0] as TaskNode).key);
  });

  it('keeps the missing final newline', () => {
    expect(document.finalNewline).toBe(false);
    expect(documentLines(document).at(-1)?.eol).toBe('');
  });
});

describe('structure: details', () => {
  it('detects tab indentation', () => {
    expect(parseDocument('- [ ] a\n\t- [ ] b\n').indentUnit).toBe('\t');
  });

  it('detects CRLF as the line ending for new lines', () => {
    expect(parseDocument('- [ ] a\r\n- [ ] b\r\n- [ ] c\n').eol).toBe('\r\n');
  });

  it('keeps blank lines between tasks as their own blocks', () => {
    const document = parseDocument('- [ ] a\n\n- [ ] b\n');
    expect(document.blocks.map((block) => block.kind)).toEqual(['task', 'other', 'task']);
  });

  it('keeps blank lines inside a task when more of the task follows', () => {
    const document = parseDocument('- [ ] a\n\n    body\n- [ ] b\n');
    expect(childText(document.blocks[0] as TaskNode)).toBe('\n    body\n');
  });

  it('only the first Completed heading starts the section', () => {
    const document = parseDocument('## Completed\n## completed ##\n');
    expect(
      document.blocks.filter((block) => block.kind === 'other' && block.completedHeading),
    ).toHaveLength(1);
  });

  it('treats a file whose frontmatter never closes as content', () => {
    const document = parseDocument('---\nflint: 1\n- [ ] a\n');
    expect(document.frontmatter).toBeNull();
    expect(titles(document)).toEqual(['a']);
  });

  it('reads quoted and commented frontmatter values', () => {
    const document = parseDocument('---\nflint: "1"\nmode: tasks # list\nid: \'x1\'\n---\n');
    expect(document.frontmatter).toMatchObject({ flint: '1', mode: 'tasks', id: 'x1' });
  });

  it('reports a newer format version and an unknown mode', () => {
    const document = parseDocument('---\nflint: 2\nmode: board\n---\n');
    expect(formatVersion(document)).toBe(2);
    expect(documentMode(document)).toBe('unknown');
  });

  it('does not treat a thematic break as a list item', () => {
    expect(parseDocument('- [ ] a\n* * *\n').blocks.map((block) => block.kind)).toEqual([
      'task',
      'other',
    ]);
  });

  it('ends a task at an under-indented line inside its code block (CommonMark)', () => {
    const document = parseDocument('- [ ] a\n    ```\ncode at column 0\n    ```\n');
    expect(childText(document.blocks[0] as TaskNode)).toBe('    ```\n');
  });
});

describe('untitled tasks: an empty task line with a body (D-45, docs/04 §3)', () => {
  const file = [
    '---',
    'flint: 1',
    'id: inbox',
    'mode: tasks',
    '---',
    '- [ ] [priority:: high] [id:: k3f9]',
    '    ```json',
    '    {',
    '      "died_at": "2026-09-10T07:55:31Z"',
    '    }',
    '    ```',
    '- [x] [completion:: 2026-10-29T15:00] [id:: m2p7]',
    '    ![](attachments/2026-10-29-150000-m2p7.png)',
    '- [ ]',
    '',
  ].join('\n');

  it('round-trips byte-for-byte and keeps the body with its task', () => {
    const document = parseDocument(file);
    expect(serializeDocument(document)).toBe(file);
    const tasks = [...allTasks(document)].map(({ task }) => task);
    expect(tasks.map((task) => task.line.title)).toEqual(['', '', '']);
    expect(tasks.map((task) => task.line.fields.id?.value)).toEqual(['k3f9', 'm2p7', undefined]);
    expect(tasks[0] ? childText(tasks[0]) : '').toContain('"died_at"');
    expect(tasks[1] ? childText(tasks[1]) : '').toContain('![](attachments/');
  });
});
