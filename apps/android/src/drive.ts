/**
 * Drive on the phone, read-only for now (R-A1, docs/06 §7): finds the Flint folder the desktop made
 * and lists what is in it. Never creates anything: a folder this app can't see means `drive.file`
 * treats the Android client as another app, which is exactly what R-A1 checks. Sync (A3) moves to
 * the shared Drive client.
 */
import { authorizeDrive, clearToken } from '../modules/flint-google-auth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

interface ApiFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly appProperties?: Record<string, string>;
}

export interface DriveFolderCheck {
  readonly email: string;
  /** The Flint folder, if this app can see it. */
  readonly folder: { readonly id: string; readonly name: string } | null;
  /** Lists and notes in it (by name), and sync's bookkeeping files. */
  readonly lists: readonly string[];
  readonly bookkeeping: readonly string[];
}

export class DriveProblem extends Error {
  constructor(
    readonly kind: 'auth' | 'offline' | 'other',
    message: string,
  ) {
    super(message);
    this.name = 'DriveProblem';
  }
}

async function call<T>(url: string, token: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new DriveProblem('offline', error instanceof Error ? error.message : String(error));
  }
  if (response.status === 401) throw new DriveProblem('auth', 'Google refused the token');
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new DriveProblem('other', `Drive answered ${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

async function children(folderId: string, token: string): Promise<ApiFile[]> {
  const files: ApiFile[] = [];
  let page: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,appProperties)',
      pageSize: '1000',
      spaces: 'drive',
      ...(page ? { pageToken: page } : {}),
    });
    const body = await call<{ files?: ApiFile[]; nextPageToken?: string }>(
      `${DRIVE_API}/files?${params.toString()}`,
      token,
    );
    files.push(...(body.files ?? []));
    page = body.nextPageToken;
  } while (page);
  return files;
}

/** Signs in (Google's consent when `interactive`) and looks for the desktop's Flint folder. */
export async function checkDriveFolder(
  folderName: string,
  interactive: boolean,
): Promise<DriveFolderCheck> {
  const granted = await authorizeDrive(interactive);
  const token = granted.accessToken;
  if (!token) throw new DriveProblem('auth', 'Google gave no access token');
  try {
    const about = await call<{ user?: { emailAddress?: string } }>(
      `${DRIVE_API}/about?fields=user(emailAddress)`,
      token,
    );
    // The same query as the desktop's (google-drive.ts): a folder Flint made, by name.
    const params = new URLSearchParams({
      q: `mimeType = '${FOLDER_TYPE}' and trashed = false and appProperties has { key='flintFolder' and value='1' } and name = '${folderName.replace(/'/g, "\\'")}'`,
      fields: 'files(id,name,mimeType,appProperties)',
      spaces: 'drive',
    });
    const found = (
      await call<{ files?: ApiFile[] }>(`${DRIVE_API}/files?${params.toString()}`, token)
    ).files?.[0];
    if (!found)
      return { email: about.user?.emailAddress ?? '', folder: null, lists: [], bookkeeping: [] };
    const inFolder = await children(found.id, token);
    const lists = inFolder
      .filter((file) => file.appProperties?.['flintKind'] === 'list')
      .map((file) => file.name.replace(/\.md$/i, ''))
      .sort((a, b) => a.localeCompare(b));
    const meta = inFolder.find(
      (file) => file.mimeType === FOLDER_TYPE && file.name === '.flint-sync',
    );
    const bookkeeping = meta
      ? (await children(meta.id, token)).map((file) => file.name).sort()
      : [];
    return {
      email: about.user?.emailAddress ?? '',
      folder: { id: found.id, name: found.name },
      lists,
      bookkeeping,
    };
  } catch (error) {
    // A refused token is dropped from Google Play services' cache, so the next try gets a new one.
    if (error instanceof DriveProblem && error.kind === 'auth') await clearToken(token);
    throw error;
  }
}
