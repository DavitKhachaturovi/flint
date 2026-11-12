import { describe, expect, it } from 'vitest';
import { pipeName, PIPE_PREFIX, sameToken } from './pipe.js';

/** AGENT-01 (D-185 Q3, security review L5, L6): the token check and the pipe's name. */
describe('the agents’ pipe', () => {
  it('compares tokens fully; an empty token never matches', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abd', 'abc')).toBe(false);
    expect(sameToken('abcd', 'abc')).toBe(false);
    expect(sameToken('', '')).toBe(false);
    expect(sameToken(undefined, 'abc')).toBe(false);
  });

  it('gets a new, unguessable name at every turn-on, under Flint’s own prefix', () => {
    const first = pipeName('C:\\Users\\Alex\\AppData\\Roaming\\Flint');
    const second = pipeName('C:\\Users\\Alex\\AppData\\Roaming\\Flint');
    expect(first.startsWith(PIPE_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(first.slice(0, -17)).toBe(second.slice(0, -17));
  });
});
