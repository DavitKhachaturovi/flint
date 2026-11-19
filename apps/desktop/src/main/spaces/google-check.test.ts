import { describe, expect, it } from 'vitest';
import { parseAccessCheck, parseInviteCheck } from './google-check.js';

const SPACE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const FILES = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210';

/** R-S1 and R-S2 (docs/06 §8): the development-only commands that start the spaces checks. */
describe('spaces check commands (R-S1, R-S2)', () => {
  it('reads an invite check: the name, one or more people, the note', () => {
    expect(
      parseInviteCheck(
        'flint-dev://dev/space-check?name=Home&to=sam@example.com&to=alex@example.com&note=Hi',
        'flint-dev',
      ),
    ).toEqual({ name: 'Home', people: ['sam@example.com', 'alex@example.com'], note: 'Hi' });
    expect(parseInviteCheck('flint-dev://dev/space-check?to=sam@example.com', 'flint-dev')).toEqual(
      {
        name: 'Spaces check',
        people: ['sam@example.com'],
        note: '',
      },
    );
  });

  it('refuses an invite check without people, with a malformed address, or for another build', () => {
    expect(parseInviteCheck('flint-dev://dev/space-check?name=Home', 'flint-dev')).toBeNull();
    expect(
      parseInviteCheck('flint-dev://dev/space-check?to=not-an-address', 'flint-dev'),
    ).toBeNull();
    expect(
      parseInviteCheck('flint-dev://dev/space-check?to=a@example.com,b@example.com', 'flint-dev'),
    ).toBeNull();
    expect(parseInviteCheck('flint://dev/space-check?to=sam@example.com', 'flint-dev')).toBeNull();
    const many = Array.from({ length: 11 }, (_, i) => `to=p${i}@example.com`).join('&');
    expect(parseInviteCheck(`flint-dev://dev/space-check?${many}`, 'flint-dev')).toBeNull();
  });

  it('reads an access check as a development join request', () => {
    expect(
      parseAccessCheck(`flint-dev://dev/space-access?g=${SPACE}.${FILES}&n=Home&d=1`, 'flint-dev'),
    ).toEqual({
      provider: 'google',
      spaceFile: SPACE,
      filesFile: FILES,
      name: 'Home',
      development: true,
    });
    expect(
      parseAccessCheck(`flint-dev://dev/space-access?g=${SPACE}&n=Home&d=1`, 'flint-dev'),
    ).toBeNull();
    expect(parseAccessCheck(`flint-dev://dev/toast?kind=reminder`, 'flint-dev')).toBeNull();
  });
});
