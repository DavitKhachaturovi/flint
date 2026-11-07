import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * M9, D-137: the performance budgets of 05 §4, measured in the normal suite on the test clock, with
 * the windows off-screen and never focused (no screen takeover). Each check fails only past its
 * hard limit; the budget itself is recorded (CI agents are slower and noisy). On CI (FLINT_CI=1) a
 * check listed in ADVISORY_ON_CI only logs, if it proved flaky there; locally every check is
 * strict. The numbers go to test-results/performance.md and 06's Measurements.
 */
test.describe.configure({ mode: 'serial' });

/** Checks that proved flaky on CI agents despite their hard limits (Davit, Q4 of M9). */
const ADVISORY_ON_CI: ReadonlySet<string> = new Set<string>([
  // A hosted Windows agent opened it in p50 373, p95 520 ms (8 Nov 2026), 2.5–3× this machine.
  'Switch to a 1,000-task list',
]);
const ON_CI = process.env.FLINT_CI === '1';
const FRAME_MS = 1000 / 60;

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();

let dataDirectory = '';
let app: ElectronApplication | undefined;

interface Measured {
  readonly name: string;
  readonly budget: string;
  readonly limit: number;
  readonly unit: string;
  readonly value: number;
  readonly detail: string;
}
const measured: Measured[] = [];

/** Records a measurement and fails past its hard limit (or only logs, for an advisory one on CI). */
function check(entry: Measured): void {
  measured.push(entry);
  const line = `${entry.name}: ${entry.value.toFixed(1)} ${entry.unit} (${entry.detail}; budget ${entry.budget}, hard limit ${entry.limit} ${entry.unit})`;
  console.log(`performance: ${line}`);
  if (entry.value <= entry.limit) return;
  if (ON_CI && ADVISORY_ON_CI.has(entry.name)) {
    console.warn(`performance (advisory on CI): over the hard limit: ${line}`);
    return;
  }
  expect(entry.value, line).toBeLessThanOrEqual(entry.limit);
}

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
};
const summary = (values: readonly number[]): string =>
  `n ${values.length}, p50 ${percentile(values, 50).toFixed(1)}, p95 ${percentile(values, 95).toFixed(1)}, max ${Math.max(...values).toFixed(1)}`;

async function launch(): Promise<{ app: ElectronApplication; main: Page }> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const started = await electron.launch({
    executablePath: electronPath,
    args: [appDirectory, '--hidden'],
    env: {
      ...env,
      FLINT_E2E: '1',
      FLINT_DATA_DIR: dataDirectory,
      FLINT_E2E_CLOCK_OFFSET: String(CLOCK_OFFSET),
    },
  });
  app = started;
  await expect
    .poll(() => started.windows().some((page) => page.url().includes('main-window')), {
      timeout: 15_000,
    })
    .toBe(true);
  const main = started.windows().find((page) => page.url().includes('main-window')) as Page;
  await main.waitForLoadState('domcontentloaded');
  await started.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1600, height: 900 });
    window.showInactive();
  });
  return { app: started, main };
}

/** Electron's metrics per process: CPU since the previous call, memory in KB. */
function metrics(running: ElectronApplication) {
  return running.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((process) => ({
      type: process.type,
      cpu: process.cpu.percentCPUUsage,
      workingKb: process.memory.workingSetSize,
      privateKb: process.memory.privateBytes ?? process.memory.workingSetSize,
    })),
  );
}

/** 1,000 tasks in one list (some with bodies, priorities and reminders), and a long note. */
async function seed(): Promise<void> {
  const tasks: string[] = ['---', 'flint: 1', 'id: big1', 'mode: tasks', '---'];
  for (let index = 0; index < 1000; index++) {
    const fields = [
      index % 7 === 0 ? '[priority:: high]' : '',
      index % 13 === 0 ? '[reminder:: 2026-03-12T10:00]' : '',
      `[id:: b${index.toString(36).padStart(4, '0')}]`,
    ].filter(Boolean);
    tasks.push(
      `- [${index % 5 === 0 ? 'x' : ' '}] Task ${index}: check the deploy log ${fields.join(' ')}`,
    );
    if (index % 25 === 0)
      tasks.push('    A short note under the task, with `code` and a link https://example.com/x');
  }
  await writeFile(join(dataDirectory, 'Flint', 'Big list.md'), `${tasks.join('\n')}\n`);
  const note = ['---', 'flint: 1', 'id: note1', 'mode: note', '---', '# Big note', ''];
  for (let index = 0; index < 400; index++) {
    note.push(
      index % 40 === 0
        ? `## Part ${index / 40}`
        : `Line ${index} of the meeting notes, with **bold** and \`code\`.`,
    );
  }
  await writeFile(join(dataDirectory, 'Flint', 'Big note.md'), `${note.join('\n')}\n`);
}

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-performance-'));
  await mkdir(join(dataDirectory, 'Flint'), { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
  await seed();
});

test.afterAll(async () => {
  await app?.close();
  app = undefined;
  await rm(dataDirectory, { recursive: true, force: true });
  const table = [
    '# Performance (D-137)',
    '',
    `Run ${new Date().toISOString()} ${ON_CI ? 'on CI' : 'locally'}.`,
    '',
    '| Check | Measured | Budget | Hard limit |',
    '|---|---|---|---|',
    ...measured.map(
      (entry) =>
        `| ${entry.name} | ${entry.value.toFixed(1)} ${entry.unit} (${entry.detail}) | ${entry.budget} | ${Number.isFinite(entry.limit) ? `${entry.limit} ${entry.unit}` : 'recorded only'} |`,
    ),
    '',
  ].join('\n');
  await mkdir(join(appDirectory, 'test-results'), { recursive: true });
  await writeFile(join(appDirectory, 'test-results', 'performance.md'), table);
});

/** Keypress → the next frame after the field changed (rAF, then a task: after the paint). */
async function keyLatencies(page: Page, selector: string, text: string): Promise<number[]> {
  await page.evaluate((target) => {
    const field = document.querySelector(target) as HTMLElement;
    const store = window as unknown as { __latencies: number[] };
    store.__latencies = [];
    let down = 0;
    field.addEventListener('keydown', (event) => {
      down = event.timeStamp;
    });
    field.addEventListener('input', () => {
      const from = down;
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => store.__latencies.push(performance.now() - from);
        channel.port2.postMessage(null);
      });
    });
  }, selector);
  for (const char of text) {
    await page.keyboard.type(char);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);
  return page.evaluate(() => (window as unknown as { __latencies: number[] }).__latencies);
}

test('memory after start (05 §4, D-137)', async () => {
  const running = (await launch()).app;
  // After start: the windows loaded, nothing opened yet (what the budget means).
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const now = await metrics(running);
  const mb = (kb: number): number => kb / 1024;
  const privateMb = mb(now.reduce((sum, process) => sum + process.privateKb, 0));
  const workingMb = mb(now.reduce((sum, process) => sum + process.workingKb, 0));
  check({
    name: 'Memory after start (private, all processes)',
    // D-137 (Davit, Q5): D-04's 150–200 MB left out Electron's GPU process.
    budget: '~300–350 MB',
    limit: 400,
    unit: 'MB',
    value: privateMb,
    detail: `${now.length} processes (${now.map((process) => `${process.type} ${mb(process.privateKb).toFixed(0)}`).join(', ')}); working set ${workingMb.toFixed(0)} MB, counting shared pages once per process`,
  });
});

test('keypress → character on screen, in the main window and the capture popup (05 §4, D-137)', async () => {
  const running = app as ElectronApplication;
  const main = running.windows().find((page) => page.url().includes('main-window')) as Page;
  await main.locator('.sidebar .nav', { hasText: 'Inbox' }).click();
  const composer = main.locator('.composer-input');
  await composer.click();
  const inMain = await keyLatencies(main, '.composer-input', 'renew the certificate before friday');
  check({
    name: 'Keypress → screen, main window',
    budget: 'one frame (~16.7 ms)',
    limit: Math.round(2 * FRAME_MS * 10) / 10,
    unit: 'ms p95',
    value: percentile(inMain, 95),
    detail: summary(inMain),
  });

  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popupPage = () => running.windows().find((page) => page.url().includes('capture-popup'));
  await expect.poll(() => popupPage() !== undefined, { timeout: 15_000 }).toBe(true);
  const popup = popupPage() as Page;
  await popup.locator('#capture').click();
  const inPopup = await keyLatencies(popup, '#capture', 'call the bank about the card !h');
  check({
    name: 'Keypress → screen, capture popup',
    budget: 'one frame (~16.7 ms)',
    limit: Math.round(2 * FRAME_MS * 10) / 10,
    unit: 'ms p95',
    value: percentile(inPopup, 95),
    detail: summary(inPopup),
  });
  await popup.keyboard.press('Escape');
});

test('Enter → popup hidden and focus back (strict), and → durably on disk (recorded), over 50 captures (05 §4, D-27, D-137)', async () => {
  const running = app as ElectronApplication;
  type Hooks = { captureDiskMs?: number[]; captureHiddenMs?: number[]; showPopup?: () => void };
  await running.evaluate(() => {
    const found = (globalThis as { __flintE2E?: Hooks }).__flintE2E;
    if (found) {
      found.captureDiskMs = [];
      found.captureHiddenMs = [];
    }
  });
  const popupPage = () =>
    running.windows().find((page) => page.url().includes('capture-popup')) as Page;
  // The first ten after a start are warm-up (Flint is still parsing the folder and taking its
  // start snapshot): recorded apart, then 50 in steady state.
  const WARM_UP = 10;
  for (let index = 0; index < WARM_UP + 50; index++) {
    await running.evaluate(() => (globalThis as { __flintE2E?: Hooks }).__flintE2E?.showPopup?.());
    const popup = popupPage();
    await popup.locator('#capture').fill(`capture ${index} for the timing`);
    await popup.locator('#capture').press('Enter');
    await expect
      .poll(() =>
        running.evaluate(
          () => (globalThis as { __flintE2E?: Hooks }).__flintE2E?.captureDiskMs?.length ?? 0,
        ),
      )
      .toBe(index + 1);
  }
  const { disk, hidden } = await running.evaluate(() => {
    const found = (globalThis as { __flintE2E?: Hooks }).__flintE2E;
    return { disk: found?.captureDiskMs ?? [], hidden: found?.captureHiddenMs ?? [] };
  });
  // Strict (Davit, Q6): the half you feel. The popup never waits for the disk (D-27).
  const steadyHidden = hidden.slice(WARM_UP);
  check({
    name: 'Enter → popup hidden and focus back',
    budget: '< 50 ms',
    limit: 50,
    unit: 'ms p95',
    value: percentile(steadyHidden, 95),
    detail: `${summary(steadyHidden)}, after ${WARM_UP} warm-up captures`,
  });
  // Recorded, never failing (Q6): the disk's flush time on this machine, not Flint's work.
  for (const [name, values] of [
    ['Enter → durably on disk (recorded, not checked)', disk.slice(WARM_UP)],
    ['Enter → on disk, the first 10 after a start (recorded)', disk.slice(0, WARM_UP)],
  ] as const) {
    measured.push({
      name,
      budget: '< 100 ms at p95',
      limit: Infinity,
      unit: 'ms p95',
      value: percentile(values, 95),
      detail: summary(values),
    });
    console.log(`performance: ${name}: ${summary(values)}`);
  }
});

/** Click a sidebar row → its page drawn (title and content), then the frame after. */
async function openTime(main: Page, name: string, ready: string): Promise<number> {
  return main.evaluate(
    ({ list, selector }) =>
      new Promise<number>((resolve, reject) => {
        const nav = [...document.querySelectorAll<HTMLElement>('.sidebar .nav')].find((each) =>
          each.textContent?.includes(list),
        );
        if (!nav) return reject(new Error(`no sidebar row for ${list}`));
        const start = performance.now();
        nav.click();
        const look = (): void => {
          const drawn =
            document.querySelector('h1')?.textContent?.includes(list) &&
            document.querySelector(selector) !== null;
          if (drawn) resolve(performance.now() - start);
          else if (performance.now() - start > 5000) reject(new Error(`${list} never drew`));
          else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }),
    { list: name, selector: ready },
  );
}

test('switching lists and opening a note, with 1,000 tasks (05 §4, D-137)', async () => {
  const main = (app as ElectronApplication)
    .windows()
    .find((page) => page.url().includes('main-window')) as Page;
  await expect(main.locator('.sidebar .nav', { hasText: 'Big list' })).toBeVisible();
  // Warm once: the first open reads the file.
  await openTime(main, 'Big list', '.row');
  await openTime(main, 'Inbox', '.composer-input');
  const lists: number[] = [];
  const notes: number[] = [];
  for (let round = 0; round < 10; round++) {
    lists.push(await openTime(main, 'Big list', '.row'));
    notes.push(await openTime(main, 'Big note', '.cm-content'));
  }
  check({
    name: 'Switch to a 1,000-task list',
    // D-137: over the 100 ms budget (a known issue: virtualised long lists after 1.0); hard 200 ms.
    budget: '< 100 ms',
    limit: 200,
    unit: 'ms p95',
    value: percentile(lists, 95),
    detail: summary(lists),
  });
  check({
    name: 'Open a 400-line note',
    budget: '< 100 ms',
    limit: 200,
    unit: 'ms p95',
    value: percentile(notes, 95),
    detail: summary(notes),
  });
});

test('Ctrl+K: results per keystroke, and the search of lists and notes (05 §4, D-137)', async () => {
  const main = (app as ElectronApplication)
    .windows()
    .find((page) => page.url().includes('main-window')) as Page;
  await main.keyboard.press('Control+k');
  const palette = main.locator('.palette[aria-label="Search or run a command"]');
  await expect(palette).toBeVisible();
  const field = palette.locator('.palette-field');
  await field.focus();
  const typed = 'task 99 deploy';
  const perKey: number[] = [];
  for (let index = 1; index <= typed.length; index++) {
    const query = typed.slice(0, index);
    const elapsed = await main.evaluate(
      ({ text }) =>
        new Promise<number>((resolve, reject) => {
          const input = document.querySelector<HTMLInputElement>('.palette-field');
          const results = document.querySelector<HTMLElement>('.palette-results');
          if (!input || !results) return reject(new Error('no palette'));
          const start = performance.now();
          // React's controlled field takes a value only through the native setter (called on it).
          // eslint-disable-next-line @typescript-eslint/unbound-method
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, text);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const look = (): void => {
            if (results.dataset['query'] === text) {
              const channel = new MessageChannel();
              channel.port1.onmessage = () => resolve(performance.now() - start);
              channel.port2.postMessage(null);
            } else if (performance.now() - start > 3000) reject(new Error('no results'));
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        }),
      { text: query },
    );
    perKey.push(elapsed);
  }
  check({
    name: 'Ctrl+K results per keystroke',
    budget: '< 50 ms',
    limit: 100,
    unit: 'ms p95',
    value: percentile(perKey, 95),
    detail: summary(perKey),
  });
  // The lists and notes are searched in the main process (a moment after the last key).
  const searches: number[] = [];
  for (const query of ['task 99', 'deploy log', 'meeting notes', 'part 3', 'certificate']) {
    searches.push(
      await main.evaluate(async (text) => {
        const start = performance.now();
        await window.flintMain.search(text, 'live');
        return performance.now() - start;
      }, query),
    );
  }
  check({
    name: 'Search of lists and notes (1,000 tasks, a long note)',
    budget: '< 50 ms',
    limit: 100,
    unit: 'ms p95',
    value: percentile(searches, 95),
    detail: summary(searches),
  });
  await main.keyboard.press('Escape');
});

test('idle: CPU over 30 s (05 §4, D-137)', async () => {
  const running = app as ElectronApplication;
  // Settle, then start the window: percentCPUUsage counts since the previous call.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await metrics(running);
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  const after = await metrics(running);
  const cpu = after.reduce((sum, process) => sum + process.cpu, 0);
  check({
    name: 'Idle CPU (all processes, 30 s)',
    budget: '~0 %',
    limit: 2,
    unit: '%',
    value: cpu,
    detail: `${after.length} processes: ${after.map((process) => process.type).join(', ')}`,
  });
});
