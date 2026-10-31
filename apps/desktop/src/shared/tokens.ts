import { listToken } from '@flint/core/shorthand';
import { formatLocalDateTime, type LocalDateTime } from '@flint/core/time';

/**
 * The shorthand a picker inserts (CAP-11, D-57): exactly what typing it would give, so chips,
 * saving and undo behave the same (CAP-03).
 */
export const PRIORITY_TOKENS = { high: '!h', medium: '!m', low: '!l' } as const;

export function listShorthand(name: string): string {
  return `##${listToken(name)}`;
}

/** `@2026-11-02 15:00`: an explicit date and time the REM-02 grammar reads exactly. */
export function timeShorthand(at: LocalDateTime): string {
  return `@${formatLocalDateTime(at).replace('T', ' ')}`;
}
