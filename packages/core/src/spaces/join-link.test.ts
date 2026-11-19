import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cleanJoinName,
  findJoinAppLink,
  joinAppLink,
  joinPageLink,
  parseJoinAppLink,
  parseJoinPageLink,
  type JoinRequest,
} from './join-link.js';

const SPACE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const FILES = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210';

const home: JoinRequest = {
  provider: 'google',
  spaceFile: SPACE,
  filesFile: FILES,
  name: 'Home',
  development: false,
};

describe('join links (SPACE-06, D-189 Q6, D-190 Q8)', () => {
  it('puts both files and the name after the #, so the site never receives them', () => {
    const link = joinPageLink(home);
    expect(link).toBe(`https://flintnotes.app/join#g=${SPACE}.${FILES}&n=Home`);
    expect(new URL(link).search).toBe('');
  });

  it('reads back what it writes, for the page link and the app link', () => {
    expect(parseJoinPageLink(joinPageLink(home))).toEqual(home);
    expect(parseJoinAppLink(joinAppLink(home), 'flint')).toEqual(home);
    const dev = { ...home, name: 'Trip crew', development: true };
    expect(joinAppLink(dev)).toMatch(/^flint-dev:\/\/join\?/);
    expect(parseJoinAppLink(joinAppLink(dev), 'flint-dev')).toEqual(dev);
    expect(parseJoinPageLink(joinPageLink(dev))).toEqual(dev);
  });

  it('acts only on its own build: an installed Flint ignores a development link and back', () => {
    const dev = { ...home, development: true };
    expect(parseJoinAppLink(joinAppLink(dev), 'flint')).toBeNull();
    expect(parseJoinAppLink(joinAppLink(home), 'flint-dev')).toBeNull();
    // A development link rewritten to the installed scheme is still a development link: refused.
    expect(
      parseJoinAppLink(joinAppLink(dev).replace('flint-dev://', 'flint://'), 'flint'),
    ).toBeNull();
  });

  it('refuses anything that is not exactly a join link', () => {
    const bad = [
      '',
      'not a link',
      `http://flintnotes.app/join#g=${SPACE}.${FILES}&n=Home`,
      `https://flintnotes.app.example/join#g=${SPACE}.${FILES}&n=Home`,
      `https://evil.example/join#g=${SPACE}.${FILES}&n=Home`,
      `https://flintnotes.app/other#g=${SPACE}.${FILES}&n=Home`,
      `https://flintnotes.app:8443/join#g=${SPACE}.${FILES}&n=Home`,
      `https://user@flintnotes.app/join#g=${SPACE}.${FILES}&n=Home`,
      `https://flintnotes.app/join#g=${SPACE}&n=Home`,
      `https://flintnotes.app/join#g=${SPACE}.${SPACE}&n=Home`,
      `https://flintnotes.app/join#g=${SPACE}.${FILES}.x123456789&n=Home`,
      `https://flintnotes.app/join#g=short.${FILES}&n=Home`,
      `https://flintnotes.app/join#g=${SPACE}.../etc/passwd&n=Home`,
      `https://flintnotes.app/join#g=${SPACE}.${FILES}`,
      `https://flintnotes.app/join#g=${SPACE}.${FILES}&n=%20%20`,
      `https://flintnotes.app/join#g=${SPACE}.${FILES}&n=Home&d=2`,
      `https://flintnotes.app/join#g=${SPACE}.${FILES}&g=${SPACE}.${FILES}&n=Home`,
    ];
    for (const link of bad) expect(parseJoinPageLink(link)).toBeNull();
    expect(parseJoinAppLink(`flint://reminder/open?id=k3f9`, 'flint')).toBeNull();
    expect(parseJoinAppLink(`flint://join/extra?g=${SPACE}.${FILES}&n=Home`, 'flint')).toBeNull();
    expect(parseJoinAppLink(`flint://joinx?g=${SPACE}.${FILES}&n=Home`, 'flint')).toBeNull();
  });

  it('accepts the page link with a trailing slash and surrounding spaces (pasted)', () => {
    expect(
      parseJoinPageLink(`  https://flintnotes.app/join/#g=${SPACE}.${FILES}&n=Home \n`),
    ).toEqual(home);
  });

  it('cleans the name: no control or direction-override characters, at most 60 characters', () => {
    expect(cleanJoinName('  Trip\u0000 \u202Ecrew\u0007  ')).toBe('Trip crew');
    expect(cleanJoinName('a\n\tb')).toBe('a b');
    expect([...cleanJoinName('x'.repeat(100))]).toHaveLength(60);
    expect([...cleanJoinName('ქ'.repeat(70))]).toHaveLength(60);
    const parsed = parseJoinPageLink(
      `https://flintnotes.app/join#g=${SPACE}.${FILES}&n=${encodeURIComponent('Home\u202E')}`,
    );
    expect(parsed?.name).toBe('Home');
  });

  it('finds the join address among a launch’s arguments', () => {
    const argv = ['C:\\flint.exe', '--hidden', joinAppLink(home)];
    expect(findJoinAppLink(argv, 'flint')).toEqual(home);
    expect(findJoinAppLink(['C:\\flint.exe'], 'flint')).toBeNull();
  });

  it('any name round-trips cleaned, and any text is either a valid request or nothing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (name) => {
        const cleaned = cleanJoinName(name);
        fc.pre(cleaned !== '');
        const parsed = parseJoinPageLink(joinPageLink({ ...home, name }));
        expect(parsed?.name).toBe(cleaned);
        expect(cleanJoinName(cleaned)).toBe(cleaned);
      }),
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        const parsed = parseJoinPageLink(`https://flintnotes.app/join#${text}`);
        if (parsed) {
          expect(parsed.spaceFile).toMatch(/^[A-Za-z0-9_-]{10,200}$/);
          expect(parsed.filesFile).toMatch(/^[A-Za-z0-9_-]{10,200}$/);
          expect(parsed.name).toBe(cleanJoinName(parsed.name));
        }
      }),
    );
  });
});
