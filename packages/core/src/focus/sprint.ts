/**
 * FOCUS-02, FOCUS-03 (D-170): Focus's sprint, kept in `.flint/focus.json` (docs/04): the tasks sent
 * to Focus, in order, each with its estimate (focus sessions it should take) and its count (focus
 * sessions finished with it active). Membership is never written into a task's line, so the file
 * format doesn't change; losing this file only empties the sprint. Tolerant reader (a missing or
 * broken file is an empty sprint, a bad entry is skipped, unknown keys are kept), canonical writer.
 */

export interface SprintTask {
  readonly id: string;
  /** Focus sessions it should take: 1 to `MAX_ESTIMATE`. */
  readonly estimate: number;
  /** Focus sessions that ran to their end with it active. */
  readonly count: number;
}

export interface Sprint {
  readonly tasks: readonly SprintTask[];
  /** Keys this version doesn't know, kept as they were. */
  readonly extra: Readonly<Record<string, unknown>>;
}

export const MAX_ESTIMATE = 99;
const MAX_COUNT = 9999;
/** docs/04 §3's read pattern for task IDs. */
const ID = /^[A-Za-z0-9_-]{1,32}$/;

export const EMPTY_SPRINT: Sprint = { tasks: [], extra: {} };

const whole = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

/** The sprint in `text`; anything unreadable gives the empty sprint. */
export function parseSprint(text: string): Sprint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_SPRINT;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_SPRINT;
  const { tasks, ...rest } = parsed as Record<string, unknown>;
  // `flint` is written again on save; everything else unknown is kept.
  const extra = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== 'flint'));
  const seen = new Set<string>();
  const read: SprintTask[] = [];
  for (const entry of Array.isArray(tasks) ? tasks : []) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, estimate, count } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    read.push({
      id,
      estimate: whole(estimate, 1, MAX_ESTIMATE, 1),
      count: whole(count, 0, MAX_COUNT, 0),
    });
  }
  return { tasks: read, extra };
}

/** The canonical text: unknown keys first, then `flint` and `tasks`; two-space JSON, a newline. */
export function serializeSprint(sprint: Sprint): string {
  return `${JSON.stringify(
    {
      ...sprint.extra,
      flint: 1,
      tasks: sprint.tasks.map(({ id, estimate, count }) => ({ id, estimate, count })),
    },
    null,
    2,
  )}\n`;
}

export const inSprint = (sprint: Sprint, id: string): boolean =>
  sprint.tasks.some((task) => task.id === id);

const withTasks = (sprint: Sprint, tasks: readonly SprintTask[]): Sprint => ({ ...sprint, tasks });

/** Sent to Focus: added at the end, in the order given, estimate 1; ones already in it stay. */
export function addToSprint(sprint: Sprint, ids: readonly string[]): Sprint {
  const added = ids.filter(
    (id, index) => ID.test(id) && !inSprint(sprint, id) && ids.indexOf(id) === index,
  );
  if (added.length === 0) return sprint;
  return withTasks(sprint, [
    ...sprint.tasks,
    ...added.map((id) => ({ id, estimate: 1, count: 0 })),
  ]);
}

/** Taken out of Focus (with their estimates and counts). */
export function removeFromSprint(sprint: Sprint, ids: readonly string[]): Sprint {
  const tasks = sprint.tasks.filter((task) => !ids.includes(task.id));
  return tasks.length === sprint.tasks.length ? sprint : withTasks(sprint, tasks);
}

/** Only the tasks `keep` accepts (a task deleted from its list leaves the sprint). */
export function pruneSprint(sprint: Sprint, keep: (id: string) => boolean): Sprint {
  const tasks = sprint.tasks.filter((task) => keep(task.id));
  return tasks.length === sprint.tasks.length ? sprint : withTasks(sprint, tasks);
}

/**
 * The sprint in the order of `ids` (Alt+↑/↓, drag, Focus on this); tasks not named keep their
 * place relative to each other, after the named ones.
 */
export function orderSprint(sprint: Sprint, ids: readonly string[]): Sprint {
  const named = ids.flatMap((id) => sprint.tasks.filter((task) => task.id === id));
  const rest = sprint.tasks.filter((task) => !ids.includes(task.id));
  const tasks = [...named, ...rest];
  return tasks.every((task, index) => task === sprint.tasks[index])
    ? sprint
    : withTasks(sprint, tasks);
}

/** FOCUS-02: Focus on this: the task first. */
export function moveToTop(sprint: Sprint, id: string): Sprint {
  return inSprint(sprint, id) ? orderSprint(sprint, [id]) : sprint;
}

function update(sprint: Sprint, id: string, change: (task: SprintTask) => SprintTask): Sprint {
  let changed = false;
  const tasks = sprint.tasks.map((task) => {
    if (task.id !== id) return task;
    const next = change(task);
    if (next.estimate !== task.estimate || next.count !== task.count) changed = true;
    return next;
  });
  return changed ? withTasks(sprint, tasks) : sprint;
}

/** FOCUS-03: the estimate, kept within 1 and `MAX_ESTIMATE`. */
export function setEstimate(sprint: Sprint, id: string, estimate: number): Sprint {
  return update(sprint, id, (task) => ({
    ...task,
    estimate: whole(estimate, 1, MAX_ESTIMATE, task.estimate),
  }));
}

/** FOCUS-03: a focus session ran to its end with this task active. */
export function countSession(sprint: Sprint, id: string): Sprint {
  return update(sprint, id, (task) => ({ ...task, count: Math.min(MAX_COUNT, task.count + 1) }));
}

/** FOCUS-02: ⋯ → Reset counts. */
export function resetCounts(sprint: Sprint): Sprint {
  return sprint.tasks.some((task) => task.count > 0)
    ? withTasks(
        sprint,
        sprint.tasks.map((task) => ({ ...task, count: 0 })),
      )
    : sprint;
}
