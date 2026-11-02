/**
 * Measurement workloads (docs/06 §1), shared by `npm run measure` and the R-1 laptop benchmark so
 * both measure the same thing. Not part of the main API (`@flint/core/bench` only).
 */

/** A busy list: 1,000 tasks with fields, some bodies and subtasks, a Completed section. */
export function benchmarkList(): string {
  let text = '---\nflint: 1\nid: big1\nmode: tasks\n---\n# Backlog\n\n';
  for (let index = 0; index < 900; index++) {
    const fields = [
      index % 7 === 0 ? '[reminder:: 2026-11-02T09:00]' : '',
      index % 5 === 0 ? '[pinned:: true]' : '',
      index % 3 === 0 ? '[priority:: high]' : '',
      `[id:: t${index.toString(36).padStart(3, '0')}]`,
    ].filter(Boolean);
    text += `- [ ] Task ${index}: fix the [[tenant]] cache for \`Vec::new\` ${fields.join(' ')}\n`;
    if (index % 10 === 0)
      text +=
        '    Body line with a link https://dev.azure.com/x/_git/y/pullrequest/42\n    ```\n    stack trace line\n    ```\n';
    if (index % 25 === 0) text += `    - [ ] Subtask of ${index} [id:: s${index.toString(36)}]\n`;
  }
  text += '\n## Completed\n';
  for (let index = 0; index < 100; index++) {
    text += `- [x] Done ${index} [completion:: 2026-10-2${index % 9}T10:00] [id:: d${index.toString(36).padStart(3, '0')}]\n`;
  }
  return text;
}

/** Lists for the shorthand measurement: 30 lists, a few of them notes. */
export function benchmarkLists(): { id: string; name: string; mode: 'tasks' | 'note' }[] {
  return Array.from({ length: 30 }, (_, index) => ({
    id: `l${index}`,
    name: index === 0 ? 'Inbox' : index === 1 ? 'Unicorn' : `Project ${index}`,
    mode: index % 6 === 5 ? 'note' : 'tasks',
  }));
}

/** Median duration of `work` over `runs` runs, after a short warm-up, using `now` (ms). */
export function medianDuration(runs: number, work: () => void, now: () => number): number {
  for (let warm = 0; warm < Math.min(20, runs); warm++) work();
  const samples: number[] = [];
  for (let run = 0; run < runs; run++) {
    const start = now();
    work();
    samples.push(now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? Number.NaN;
}
