/**
 * R-S1 and R-S2 (docs/06 §8, D-189, D-190): the first real pieces of shared spaces on Google Drive,
 * production code (D-18) that S3 builds on: making a space's two files and inviting people (shared
 * silently, then the inviter's own ready-made e-mail with the join link, D-190 Q18: R-S1 found the
 * link in Google's own e-mail unclickable), and joining from the join link through Google's picker
 * (D-189 Q6, D-190 Q8). Until S3's dialogs exist, a development-only command starts
 * the invite and a dialog reports what each step found; the files hold a placeholder until S2's
 * format (04 §9) replaces it.
 */
import { randomBytes } from 'node:crypto';
import {
  gmailComposeUrl,
  inviteEmail,
  isGmailAddress,
  joinPageLink,
  mailtoUrl,
  parseJoinAppLink,
  type GoogleJoin,
} from '@flint/core/spaces';
import { GOOGLE_CLIENT, googleDriveFor } from '../sync/connection.js';
import {
  NoGoogleAccount,
  SPACE_FILES_MIME,
  SPACE_MIME,
  type GoogleDrive,
} from '../sync/google-drive.js';
import { signIn, type Fetch } from '../sync/oauth.js';

export interface SpacesCheckDeps {
  /** Sync's own session (the network guard lets it reach Google while `network` is on). */
  readonly fetch: Fetch;
  /** Opens a page in the default browser (the sign-in and the picker). */
  readonly open: (url: string) => void;
  /** The account connected for personal sync: the check's space is made in its Drive. */
  readonly account: () => Promise<{ readonly email: string; readonly refreshToken: string } | null>;
  /** "Flint spaces", or "Flint spaces (development)" in development builds (05 §5). */
  readonly folderName: string;
  readonly development: boolean;
  /** This PC's name (04 §7), recorded on the files Flint writes. */
  readonly device: string;
  readonly log: (line: string) => void;
  /** Shows the outcome (a dialog until S3's own UI). */
  readonly say: (title: string, detail: string) => void;
  /** Lets sync's session reach Google while a spaces step runs. */
  readonly network: (on: boolean) => void;
}

export interface InviteCheck {
  readonly name: string;
  readonly people: readonly string[];
  readonly note: string;
}

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,}$/;

/**
 * `flint-dev://dev/space-check?name=Home&to=sam@example.com&note=…` (development builds only):
 * makes a space and invites the people named (R-S1). Several `to` are allowed.
 */
export function parseInviteCheck(argument: string, scheme: string): InviteCheck | null {
  if (!argument.startsWith(`${scheme}://dev/space-check`)) return null;
  let url: URL;
  try {
    url = new URL(argument);
  } catch {
    return null;
  }
  const name = (url.searchParams.get('name') ?? 'Spaces check').trim().slice(0, 60);
  const people = url.searchParams.getAll('to').map((to) => to.trim());
  if (name === '' || people.length === 0 || people.length > 10) return null;
  if (!people.every((person) => EMAIL.test(person))) return null;
  return { name, people, note: (url.searchParams.get('note') ?? '').slice(0, 500) };
}

/**
 * `flint-dev://dev/space-access?g=<space file>.<files file>&n=<name>` (development builds only):
 * a plain sign-in, no picker, then tries to open both files: whether a pick carries over to another
 * sign-in of the same account, as another device of it would make (R-S2).
 */
export function parseAccessCheck(argument: string, scheme: string): GoogleJoin | null {
  const prefix = `${scheme}://dev/space-access`;
  if (!argument.startsWith(prefix)) return null;
  return parseJoinAppLink(`${scheme}://join${argument.slice(prefix.length)}`, scheme);
}

const encoder = new TextEncoder();

/** The placeholder a check space holds until S2's format (04 §9). */
function placeholder(kind: string, name: string, spaceId: string, device: string): Uint8Array {
  return encoder.encode(
    `${JSON.stringify({ flint: 1, kind, check: 'R-S1/R-S2', space: spaceId, name, made: new Date().toISOString(), by: device, writes: [] }, null, 2)}\n`,
  );
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** R-S1: makes a space's two files in the connected account's Drive and invites the people. */
export async function createAndInvite(deps: SpacesCheckDeps, check: InviteCheck): Promise<void> {
  const account = await deps.account();
  if (!account) {
    deps.say(
      'Connect Google Drive first',
      'The check space is made in the Drive connected in Settings → Sync.',
    );
    return;
  }
  deps.network(true);
  try {
    const drive = googleDriveFor(deps.fetch, account.refreshToken);
    const folder = await drive.spacesFolder(deps.folderName);
    const spaceId = `s-${randomBytes(4).toString('hex')}`;
    const ids = await drive.createSpaceFiles(
      folder,
      check.name,
      spaceId,
      {
        space: placeholder('space', check.name, spaceId, deps.device),
        files: placeholder('space-files', check.name, spaceId, deps.device),
      },
      deps.device,
    );
    const request: GoogleJoin = {
      provider: 'google',
      spaceFile: ids.spaceFile,
      filesFile: ids.filesFile,
      name: check.name,
      development: deps.development,
    };
    // Silent shares (D-190 Q18): Google's own e-mail never goes out. An address without a Google
    // account is refused by Drive before anything is shared with it.
    const shared: string[] = [];
    const noAccount: string[] = [];
    for (const person of check.people) {
      try {
        await drive.shareWith(ids.spaceFile, person);
      } catch (error) {
        if (error instanceof NoGoogleAccount) {
          noAccount.push(person);
          continue;
        }
        throw error;
      }
      await drive.shareWith(ids.filesFile, person);
      shared.push(person);
    }
    deps.log(
      `spaces check: made ${check.name} (${spaceId}) in ${deps.folderName}, shared with ${shared.length}, ${noAccount.length} without a Google account; link ${joinPageLink(request)}`,
    );
    const refused =
      noAccount.length === 0
        ? ''
        : `\n\nNot invited: ${noAccount.join(', ')} ${noAccount.length === 1 ? 'has' : 'have'} no Google account. Everyone in a Google Drive space needs one.`;
    if (shared.length === 0) {
      deps.say(`Nobody invited to ${check.name}`, refused.trim());
      return;
    }
    // The inviter's own e-mail, ready to send: Gmail's compose page for a Gmail account, the mail
    // app otherwise. Flint only opens it; the inviter presses Send.
    const email = inviteEmail(check.note, request);
    deps.open(
      isGmailAddress(account.email) ? gmailComposeUrl(shared, email) : mailtoUrl(shared, email),
    );
    deps.say(
      `Shared ${check.name}: now send the invite`,
      `${check.name} is shared with ${shared.join(', ')} (Google sent no e-mail). Your invite e-mail is open, ready to send: press Send there.${refused}\n\nThe link, to send another way:\n${joinPageLink(request)}`,
    );
  } catch (error) {
    deps.log(`spaces check: making or inviting failed: ${describe(error)}`);
    deps.say('Invite failed', describe(error));
  } finally {
    deps.network(false);
  }
}

interface FileFindings {
  readonly lines: string[];
  readonly ok: boolean;
}

/** Opens, reads and (for the space file) writes one file: what this account can do with it. */
async function tryFile(
  drive: GoogleDrive,
  id: string,
  label: string,
  expected: { readonly mime: string; readonly kind: string },
  write: { readonly device: string; readonly email: string } | null,
): Promise<FileFindings> {
  const lines: string[] = [];
  const info = await drive.spaceFileInfo(id);
  if (!info) return { lines: [`${label}: can't open it (not picked, or gone)`], ok: false };
  const isFlint = info.mimeType === expected.mime && info.kind === expected.kind;
  lines.push(
    `${label}: opens ("${info.name}", ${isFlint ? 'a Flint space file' : `NOT a Flint space file: ${info.mimeType}, ${info.kind ?? 'no kind'}`}, ${info.canEdit ? 'can edit' : 'read-only'})`,
  );
  let ok = isFlint && info.canEdit;
  const bytes = await drive.readSpaceFile(id);
  lines.push(`${label}: read ${bytes.length} bytes`);
  if (write && ok) {
    const text = new TextDecoder().decode(bytes);
    const data = JSON.parse(text) as { writes?: unknown[] };
    const writes = Array.isArray(data.writes) ? data.writes : [];
    data.writes = [
      ...writes,
      { at: new Date().toISOString(), by: write.device, account: write.email },
    ];
    const revision = await drive.writeSpaceFile(
      id,
      encoder.encode(`${JSON.stringify(data, null, 2)}\n`),
      write.device,
    );
    const after = await drive.spaceFileInfo(id);
    const wrote = after !== null && after.revision === revision && revision !== info.revision;
    lines.push(`${label}: ${wrote ? 'wrote it (a new revision)' : 'write NOT confirmed'}`);
    ok = ok && wrote;
  }
  return { lines, ok };
}

/** R-S2: joins from a join link: Google's picker for the space's two files, then open, read, write. */
export async function joinGoogleSpace(deps: SpacesCheckDeps, request: GoogleJoin): Promise<void> {
  deps.network(true);
  deps.log(`spaces: joining ${request.name}: Google's picker opens in the browser`);
  try {
    const pending = signIn(GOOGLE_CLIENT, deps.open, deps.fetch, {
      fileIds: [request.spaceFile, request.filesFile],
      allowMultiple: true,
      chooseAccount: true,
    });
    const tokens = await pending.result;
    const picked = tokens.picked ?? [];
    const drive = googleDriveFor(deps.fetch, tokens.refreshToken, tokens);
    const email = await drive.email();
    const pickedBoth = picked.includes(request.spaceFile) && picked.includes(request.filesFile);
    const lines = [
      `Account: ${email}`,
      `Picked ${picked.length} file(s): ${pickedBoth ? 'both of the space’s files in one Select' : picked.includes(request.spaceFile) ? 'only the space file' : picked.includes(request.filesFile) ? 'only the attachments file' : 'neither of the space’s files'}`,
    ];
    const space = await tryFile(
      drive,
      request.spaceFile,
      'Space file',
      { mime: SPACE_MIME, kind: 'space' },
      { device: deps.device, email },
    );
    const files = await tryFile(
      drive,
      request.filesFile,
      'Attachments file',
      { mime: SPACE_FILES_MIME, kind: 'space-files' },
      null,
    );
    lines.push(...space.lines, ...files.lines);
    const passed = space.ok && files.ok;
    deps.log(`spaces: join check ${passed ? 'passed' : 'failed'}: ${lines.join(' | ')}`);
    deps.say(
      passed ? `Joined ${request.name} (check passed)` : `Joining ${request.name}: check failed`,
      lines.join('\n'),
    );
  } catch (error) {
    deps.log(`spaces: joining ${request.name} failed: ${describe(error)}`);
    deps.say(`Joining ${request.name} failed`, describe(error));
  } finally {
    deps.network(false);
  }
}

/** R-S2's second half: does a plain sign-in of the same account (another device) open the files? */
export async function accessCheck(deps: SpacesCheckDeps, request: GoogleJoin): Promise<void> {
  deps.network(true);
  try {
    const tokens = await signIn(GOOGLE_CLIENT, deps.open, deps.fetch).result;
    const drive = googleDriveFor(deps.fetch, tokens.refreshToken, tokens);
    const email = await drive.email();
    const space = await tryFile(
      drive,
      request.spaceFile,
      'Space file',
      { mime: SPACE_MIME, kind: 'space' },
      null,
    );
    const files = await tryFile(
      drive,
      request.filesFile,
      'Attachments file',
      { mime: SPACE_FILES_MIME, kind: 'space-files' },
      null,
    );
    const lines = [
      `Account: ${email} (a plain sign-in, no picker)`,
      ...space.lines,
      ...files.lines,
    ];
    const passed = space.ok && files.ok;
    deps.log(`spaces: access check ${passed ? 'passed' : 'failed'}: ${lines.join(' | ')}`);
    deps.say(
      passed ? 'The pick carries over (check passed)' : 'The pick does not carry over',
      lines.join('\n'),
    );
  } catch (error) {
    deps.log(`spaces: access check failed: ${describe(error)}`);
    deps.say('Access check failed', describe(error));
  } finally {
    deps.network(false);
  }
}
