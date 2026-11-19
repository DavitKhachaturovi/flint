import { describe, expect, it } from 'vitest';
import { gmailComposeUrl, inviteEmail, isGmailAddress, mailtoUrl } from './invite.js';
import { joinPageLink, parseJoinPageLink, type JoinRequest } from './join-link.js';

const trip: JoinRequest = {
  provider: 'google',
  spaceFile: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  filesFile: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa543210',
  name: 'Trip crew',
  development: false,
};

/** SPACE-05, D-190 Q18: the inviter's own e-mail, with the join link on a line of its own. */
describe('the invite e-mail (SPACE-05, D-190 Q18)', () => {
  it('names the space, carries the note, and the link stands alone on its line', () => {
    const email = inviteEmail('  For the weekend  ', trip);
    expect(email.subject).toBe('Join Trip crew in Flint');
    const lines = email.body.split('\n');
    expect(lines[0]).toBe('For the weekend');
    expect(lines).toContain(joinPageLink(trip));
    expect(email.body).toContain('select both and click Select');
    expect(inviteEmail('', trip).body.startsWith('I\'m sharing "Trip crew" with you')).toBe(true);
  });

  it("Gmail's compose page carries the recipients, subject and body, and the link survives intact", () => {
    const email = inviteEmail('Hi', trip);
    const url = new URL(gmailComposeUrl(['sam@example.com', 'alex@example.com'], email));
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('to')).toBe('sam@example.com,alex@example.com');
    expect(url.searchParams.get('su')).toBe('Join Trip crew in Flint');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toBe(email.body);
    const link = body.split('\n').find((line) => line.startsWith('https://flintnotes.app/join#'));
    expect(parseJoinPageLink(link ?? '')).toEqual(trip);
  });

  it('a mailto: address uses CRLF line breaks and keeps the link intact', () => {
    const email = inviteEmail('Hi', trip);
    const url = mailtoUrl(['sam@example.com'], email);
    expect(
      url.startsWith('mailto:sam%40example.com?subject=Join%20Trip%20crew%20in%20Flint&body='),
    ).toBe(true);
    expect(url).toContain('%0D%0A');
    const body = decodeURIComponent(url.slice(url.indexOf('&body=') + 6)).replace(/\r\n/g, '\n');
    expect(body).toBe(email.body);
  });

  it('knows Gmail addresses', () => {
    expect(isGmailAddress('someone@gmail.com')).toBe(true);
    expect(isGmailAddress(' Someone@GoogleMail.com ')).toBe(true);
    expect(isGmailAddress('someone@example.com')).toBe(false);
    expect(isGmailAddress('someone@gmail.com.example')).toBe(false);
  });
});
