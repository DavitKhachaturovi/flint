import type { LimitsInfo, LimitsPreset } from './protocol.js';

/**
 * AGENT-01 (D-185 Q8): how much agents may do. The preset is the user's (Settings → AI agents);
 * the size limits, connections and timeouts are fixed.
 */
export interface Limits {
  readonly itemsPerRequest: number;
  readonly taskDeletesPerRequest: number;
  readonly listDeletesPerRequest: number;
  readonly changesPerHour: number;
}

export const LIMIT_PRESETS: Readonly<Record<LimitsPreset, Limits>> = {
  low: {
    itemsPerRequest: 25,
    taskDeletesPerRequest: 10,
    listDeletesPerRequest: 2,
    changesPerHour: 150,
  },
  medium: {
    itemsPerRequest: 100,
    taskDeletesPerRequest: 25,
    listDeletesPerRequest: 5,
    changesPerHour: 500,
  },
  high: {
    itemsPerRequest: 250,
    taskDeletesPerRequest: 100,
    listDeletesPerRequest: 20,
    changesPerHour: 2000,
  },
};

/** Fixed, whatever the preset. */
export const FIXED_LIMITS = {
  /** A task's title. */
  titleChars: 1000,
  /** A note's text, a body, an appended or replacing passage. */
  textBytes: 1024 * 1024,
  /** One request, as it arrives on the pipe. */
  requestBytes: 2 * 1024 * 1024,
  connections: 8,
  requestMs: 30_000,
  /** At most this many items in one read. */
  readItems: 20,
} as const;

const HOUR = 60 * 60 * 1000;

/**
 * The hourly budget across all agents: changed items in the last hour. When a request would go
 * past it, agent writes pause until the user resumes them (the budget then starts again).
 */
export class ChangeBudget {
  private events: { readonly at: number; readonly count: number }[] = [];

  /** Items changed in the hour before `now`. */
  used(now: number): number {
    this.events = this.events.filter((event) => now - event.at < HOUR);
    return this.events.reduce((sum, event) => sum + event.count, 0);
  }

  /** Whether `count` more fit in `limit`. */
  fits(count: number, limit: number, now: number): boolean {
    return this.used(now) + count <= limit;
  }

  spend(count: number, now: number): void {
    if (count > 0) this.events.push({ at: now, count });
  }

  /** Resume: the hour starts again. */
  reset(): void {
    this.events = [];
  }
}

export function limitsInfo(preset: LimitsPreset, used: number): LimitsInfo {
  return { preset, ...LIMIT_PRESETS[preset], usedThisHour: used };
}

export function isPreset(value: unknown): value is LimitsPreset {
  return value === 'low' || value === 'medium' || value === 'high';
}
