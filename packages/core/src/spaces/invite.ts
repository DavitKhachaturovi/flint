/**
 * The invite e-mail (SPACE-05, D-190 Q18): after R-S1 found the link in Google's own "shared with
 * you" e-mail can't be clicked, Flint shares a space's files silently and opens a ready-made e-mail
 * from the inviter (Gmail's compose page, or the mail app), which the inviter sends. Flint sends no
 * e-mail, needs no mail access and makes no request: it only opens an address in the browser.
 */
import { cleanJoinName, joinPageLink, type JoinRequest } from './join-link.js';

export interface InviteEmail {
  readonly subject: string;
  readonly body: string;
}

/** The e-mail's subject and plain-text body: the inviter's note, the link on its own line, and help. */
export function inviteEmail(note: string, request: JoinRequest): InviteEmail {
  const name = cleanJoinName(request.name);
  const own = note.trim();
  const lines = [
    ...(own === '' ? [] : [own, '']),
    `I'm sharing "${name}" with you in Flint. Click to join:`,
    joinPageLink(request),
    '',
    `Google will ask you to pick the space's two files: select both and click Select. If the link doesn't open, copy it into your browser, or paste it in Flint (Ctrl+K, Join with an invite link).`,
    '',
    `Don't have Flint yet? https://flintnotes.app`,
  ];
  return { subject: `Join ${name} in Flint`, body: lines.join('\n') };
}

/** Whether an address's mail is Gmail (then Gmail's compose page is the better way to write it). */
export function isGmailAddress(address: string): boolean {
  return /@(gmail|googlemail)\.com$/i.test(address.trim());
}

/** Gmail's compose page with the e-mail filled in (opened in the browser, never fetched by Flint). */
export function gmailComposeUrl(to: readonly string[], email: InviteEmail): string {
  const parts = [
    'view=cm',
    'fs=1',
    `to=${encodeURIComponent(to.join(','))}`,
    `su=${encodeURIComponent(email.subject)}`,
    `body=${encodeURIComponent(email.body)}`,
  ];
  return `https://mail.google.com/mail/?${parts.join('&')}`;
}

/** A `mailto:` address for the default mail app (RFC 6068: line breaks as %0D%0A). */
export function mailtoUrl(to: readonly string[], email: InviteEmail): string {
  const encode = (text: string): string => encodeURIComponent(text).replace(/%0A/g, '%0D%0A');
  const recipients = to.map((address) => encodeURIComponent(address)).join(',');
  return `mailto:${recipients}?subject=${encode(email.subject)}&body=${encode(email.body)}`;
}
