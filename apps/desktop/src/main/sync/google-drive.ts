/**
 * Google Drive through its REST API (SYNC-01, D-161, docs/05 §5): the `Drive` the sync engine
 * works against. Lists live in the Flint folder itself, attachments in `attachments/`, sync's
 * bookkeeping in `.flint-sync/`; every file Flint makes carries `appProperties` (kind, Flint ID,
 * the PC that wrote it), so nothing is matched by name alone. Requests go through sync's own
 * session (`fetch`), with the access token from `token()`.
 */
import { DriveError, type Drive, type RemoteFile, type RemoteFolder } from '@flint/core/sync';
import { DRIVE_API, DRIVE_UPLOAD } from './google.js';
import type { Fetch } from './oauth.js';

const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const FILE_FIELDS =
  'id,name,mimeType,trashed,parents,appProperties,md5Checksum,headRevisionId,size,modifiedTime';
const SIMPLE_LIMIT = 5 * 1024 * 1024;
const SUBFOLDERS = { attachment: 'attachments', meta: '.flint-sync' } as const;

interface ApiFile {
  id: string;
  name: string;
  mimeType?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
  md5Checksum?: string;
  headRevisionId?: string;
  size?: string;
  modifiedTime?: string;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface GoogleDriveOptions {
  readonly fetch: Fetch;
  /** A valid access token (refreshed when needed); `fresh`: the last one was refused. */
  readonly token: (fresh: boolean) => Promise<string>;
}

export class GoogleDrive implements Drive {
  private readonly fetch: Fetch;
  private readonly token: (fresh: boolean) => Promise<string>;
  /** Subfolder IDs per sync folder and kind. */
  private readonly subfolders = new Map<string, string>();

  constructor(options: GoogleDriveOptions) {
    this.fetch = options.fetch;
    this.token = options.token;
  }

  /** One request, with the token, retried on 401 (once, a fresh token) and on 429/5xx (backing off). */
  private async request(
    url: string,
    init: RequestInit = {},
    notFound?: () => never,
  ): Promise<Response> {
    let fresh = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(fresh);
      let response: Response;
      try {
        response = await this.fetch(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        throw new DriveError('offline', error instanceof Error ? error.message : String(error));
      }
      if (response.ok) return response;
      if (response.status === 401 && !fresh) {
        fresh = true;
        continue;
      }
      if (response.status === 401) throw new DriveError('auth');
      if (response.status === 404 && notFound) notFound();
      const text = await response.text().catch(() => '');
      if (
        response.status === 403 &&
        /storageQuotaExceeded|quotaExceeded"|The user's Drive storage quota/i.test(text)
      ) {
        throw new DriveError('quota');
      }
      if (
        (response.status === 429 ||
          response.status >= 500 ||
          /rateLimitExceeded|userRateLimitExceeded/.test(text)) &&
        attempt < 3
      ) {
        await wait(2000 * 2 ** attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500)
        throw new DriveError('offline', `Drive answered ${response.status}`);
      throw new DriveError('other', `Drive answered ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  private async json<T>(url: string, init?: RequestInit, notFound?: () => never): Promise<T> {
    return (await (await this.request(url, init, notFound)).json()) as T;
  }

  private remote(file: ApiFile, kind: RemoteFile['kind']): RemoteFile {
    const properties = file.appProperties ?? {};
    const name = kind === 'list' ? file.name.replace(/\.md$/i, '') : file.name;
    return {
      id: file.id,
      name,
      kind,
      flintId: properties['flintId'] ?? file.name,
      revision: file.md5Checksum ?? file.headRevisionId ?? file.modifiedTime ?? '',
      size: Number(file.size ?? 0),
      modifiedTime: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
      device: properties['device'] ?? null,
    };
  }

  private async children(folderId: string): Promise<ApiFile[]> {
    const files: ApiFile[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        spaces: 'drive',
        ...(page ? { pageToken: page } : {}),
      });
      const body = await this.json<{ files?: ApiFile[]; nextPageToken?: string }>(
        `${DRIVE_API}/files?${params.toString()}`,
      );
      files.push(...(body.files ?? []));
      page = body.nextPageToken;
    } while (page);
    return files;
  }

  async folder(knownId: string | null, name: string): Promise<RemoteFolder> {
    const gone = (): never => {
      throw new DriveError('folder-gone');
    };
    if (knownId !== null) {
      const file = await this.json<ApiFile>(
        `${DRIVE_API}/files/${encodeURIComponent(knownId)}?fields=${FILE_FIELDS}`,
        {},
        gone,
      );
      if (file.trashed) gone();
      return { id: file.id, path: await this.path(file) };
    }
    // drive.file sees only what Flint made: a folder another of this user's PCs made is reused.
    const params = new URLSearchParams({
      q: `mimeType = '${FOLDER_TYPE}' and trashed = false and appProperties has { key='flintFolder' and value='1' } and name = '${name.replace(/'/g, "\\'")}'`,
      fields: `files(${FILE_FIELDS})`,
      spaces: 'drive',
    });
    const found =
      (await this.json<{ files?: ApiFile[] }>(`${DRIVE_API}/files?${params.toString()}`)).files ??
      [];
    const existing = found.find((file) => file.parents?.length) ?? found[0];
    if (existing) return { id: existing.id, path: await this.path(existing) };
    const made = await this.json<ApiFile>(`${DRIVE_API}/files?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_TYPE,
        parents: ['root'],
        appProperties: { flintFolder: '1' },
      }),
    });
    return { id: made.id, path: `My Drive › ${made.name}` };
  }

  /** "My Drive › Flint", or with "…" where a parent isn't Flint's to see (drive.file). */
  private async path(file: ApiFile): Promise<string> {
    const names = [file.name];
    let parent = file.parents?.[0];
    for (let depth = 0; parent && depth < 8; depth++) {
      try {
        const up = await this.json<ApiFile>(
          `${DRIVE_API}/files/${encodeURIComponent(parent)}?fields=id,name,parents`,
        );
        if (!up.parents?.length) break;
        names.unshift(up.name);
        parent = up.parents[0];
      } catch {
        names.unshift('…');
        break;
      }
    }
    return ['My Drive', ...names].join(' › ');
  }

  private async subfolder(
    folderId: string,
    kind: 'attachment' | 'meta',
    create: boolean,
  ): Promise<string | null> {
    const key = `${folderId}/${kind}`;
    const known = this.subfolders.get(key);
    if (known) return known;
    const name = SUBFOLDERS[kind];
    const found = (await this.children(folderId)).find(
      (file) => file.mimeType === FOLDER_TYPE && file.name === name,
    );
    if (found) {
      this.subfolders.set(key, found.id);
      return found.id;
    }
    if (!create) return null;
    const made = await this.json<ApiFile>(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [folderId] }),
    });
    this.subfolders.set(key, made.id);
    return made.id;
  }

  async list(folderId: string): Promise<RemoteFile[]> {
    const gone = (): never => {
      throw new DriveError('folder-gone');
    };
    const top = await this.children(folderId).catch((error: unknown) => {
      if (error instanceof DriveError && error.problem === 'other' && /404/.test(error.message))
        gone();
      throw error;
    });
    const out: RemoteFile[] = [];
    for (const file of top) {
      if (file.mimeType === FOLDER_TYPE) {
        const kind =
          file.name === SUBFOLDERS.attachment
            ? 'attachment'
            : file.name === SUBFOLDERS.meta
              ? 'meta'
              : null;
        if (!kind) continue;
        this.subfolders.set(`${folderId}/${kind}`, file.id);
        for (const inner of await this.children(file.id)) {
          if (inner.mimeType !== FOLDER_TYPE) out.push(this.remote(inner, kind));
        }
      } else if (file.appProperties?.['flintKind'] === 'list') {
        out.push(this.remote(file, 'list'));
      }
    }
    return out;
  }

  async read(file: RemoteFile): Promise<Uint8Array> {
    const response = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  private async upload(
    method: 'POST' | 'PATCH',
    path: string,
    metadata: Record<string, unknown>,
    content: Uint8Array,
  ): Promise<ApiFile> {
    const type = 'application/octet-stream';
    if (content.length <= SIMPLE_LIMIT) {
      const boundary = `flint-${Math.random().toString(36).slice(2)}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return this.json<ApiFile>(
        `${DRIVE_UPLOAD}/files${path}?uploadType=multipart&fields=${FILE_FIELDS}`,
        {
          method,
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: Buffer.concat([head, Buffer.from(content), tail]),
        },
      );
    }
    // Large attachments: a resumable session, the bytes in one PUT (Drive resumes on its side).
    const start = await this.request(
      `${DRIVE_UPLOAD}/files${path}?uploadType=resumable&fields=${FILE_FIELDS}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': type,
          'X-Upload-Content-Length': String(content.length),
        },
        body: JSON.stringify(metadata),
      },
    );
    const location = start.headers.get('location');
    if (!location) throw new DriveError('other', 'Drive gave no upload address');
    return this.json<ApiFile>(location, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: Buffer.from(content),
    });
  }

  async create(
    folderId: string,
    kind: RemoteFile['kind'],
    name: string,
    flintId: string,
    content: Uint8Array,
    device: string,
  ): Promise<RemoteFile> {
    const parent = kind === 'list' ? folderId : await this.subfolder(folderId, kind, true);
    const file = await this.upload(
      'POST',
      '',
      {
        name: kind === 'list' ? `${name}.md` : name,
        parents: [parent],
        mimeType:
          kind === 'list' ? 'text/markdown' : kind === 'meta' ? 'application/json' : undefined,
        appProperties: { flintKind: kind, flintId, device },
      },
      content,
    );
    return this.remote(file, kind);
  }

  async update(
    file: RemoteFile,
    content: Uint8Array | null,
    options: { readonly name?: string; readonly device: string; readonly expect?: string },
  ): Promise<RemoteFile> {
    if (options.expect !== undefined) {
      // Drive has no conditional write: the revision is checked right before writing.
      const now = await this.json<ApiFile>(
        `${DRIVE_API}/files/${encodeURIComponent(file.id)}?fields=${FILE_FIELDS}`,
      );
      const current = this.remote(now, file.kind);
      if (current.revision !== options.expect) {
        // D-181: for the log: what this run expected, what Drive has, and who wrote it when.
        const short = (revision: string): string => revision.slice(0, 8) || 'none';
        throw new DriveError(
          'changed',
          `expected ${short(options.expect)}, Drive has ${short(current.revision)}, written by ${current.device ?? 'unknown'} at ${now.modifiedTime ?? '?'}`,
        );
      }
    }
    const metadata: Record<string, unknown> = {
      ...(options.name !== undefined
        ? { name: file.kind === 'list' ? `${options.name}.md` : options.name }
        : {}),
      ...(content ? { appProperties: { device: options.device } } : {}),
    };
    const updated = content
      ? await this.upload('PATCH', `/${encodeURIComponent(file.id)}`, metadata, content)
      : await this.json<ApiFile>(
          `${DRIVE_API}/files/${encodeURIComponent(file.id)}?fields=${FILE_FIELDS}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata),
          },
        );
    return this.remote(updated, file.kind);
  }

  async trash(file: RemoteFile): Promise<void> {
    await this.request(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  /** The account's address (Drive's about.get: no extra scope needed). */
  async email(): Promise<string> {
    const about = await this.json<{ user?: { emailAddress?: string } }>(
      `${DRIVE_API}/about?fields=user(emailAddress)`,
    );
    return about.user?.emailAddress ?? '';
  }
}
