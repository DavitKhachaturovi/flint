import koffi, { type TypeObject } from 'koffi';

/**
 * NAV-08, D-127: Windows' own clipboard history (Win+V), read through its WinRT interfaces with
 * koffi (no compiled add-on, D-30). Read-only: Flint never writes, clears or deletes anything here,
 * and never records the clipboard itself. Text items only for now. Windows answers only while
 * Flint is in the foreground (else "access denied").
 *
 * The method positions are Windows' own (from `C:\Windows\System32\WinMetadata`, 7 Nov 2026): a
 * wrong one would call a different method, so only the reads below are ever called, each by its
 * checked position. Every call goes through `vcall`, every result is checked, every object
 * released.
 */

const combase = koffi.load('combase.dll');

const roInitialize = combase.func('int RoInitialize(int initType)') as (kind: number) => number;
const windowsCreateString = combase.func(
  'int WindowsCreateString(const char16_t *sourceString, uint32 length, _Out_ void **string)',
) as (source: string, length: number, out: unknown[]) => number;
const windowsDeleteString = combase.func('int WindowsDeleteString(void *string)') as (
  string: unknown,
) => number;
const windowsGetStringRawBuffer = combase.func(
  'void *WindowsGetStringRawBuffer(void *string, _Out_ uint32_t *length)',
) as (string: unknown, length: number[]) => unknown;
const roGetActivationFactory = combase.func(
  'int RoGetActivationFactory(void *activatableClassId, void *iid, _Out_ void **factory)',
) as (classId: unknown, iid: Buffer, out: unknown[]) => number;

// The shapes of the methods called (x64: one calling convention).
const QueryInterface = koffi.proto(
  'int ComQueryInterface(void *self, void *iid, _Out_ void **out)',
);
const Release = koffi.proto('uint32 ComRelease(void *self)');
const GetObject = koffi.proto('int ComGetObject(void *self, _Out_ void **out)');
const GetAt = koffi.proto('int ComGetAt(void *self, uint32 index, _Out_ void **out)');
const GetBool = koffi.proto('int ComGetBool(void *self, _Out_ uint8_t *out)');
const GetInt32 = koffi.proto('int ComGetInt32(void *self, _Out_ int32_t *out)');
const GetUint32 = koffi.proto('int ComGetUint32(void *self, _Out_ uint32_t *out)');
const GetInt64 = koffi.proto('int ComGetInt64(void *self, _Out_ int64_t *out)');
const ContainsFormat = koffi.proto('int ComContains(void *self, void *format, _Out_ uint8_t *out)');
const Close = koffi.proto('int ComClose(void *self)');

/** Method positions (IInspectable's six come first). */
const AT = {
  queryInterface: 0,
  release: 2,
  // IClipboardStatics2 {D2AC1B6A-D29F-554B-B303-F0452345FE02}. 7 (ClearHistory), 8
  // (DeleteItemFromHistory) and 9 (SetHistoryItemAsContent) are never called.
  getHistoryItemsAsync: 6,
  isHistoryEnabled: 10,
  // IClipboardHistoryItemsResult
  resultStatus: 6,
  resultItems: 7,
  // IVectorView<T>
  vectorGetAt: 6,
  vectorSize: 7,
  // IClipboardHistoryItem
  itemTimestamp: 7,
  itemContent: 8,
  // IDataPackageView
  viewContains: 10,
  viewGetTextAsync: 12,
  // IAsyncInfo {00000036-0000-0000-C000-000000000046}
  asyncStatus: 7,
  asyncClose: 10,
  // IAsyncOperation<T>
  asyncGetResults: 8,
} as const;

const IID_CLIPBOARD_STATICS_2 = guid('D2AC1B6A-D29F-554B-B303-F0452345FE02');
const IID_ASYNC_INFO = guid('00000036-0000-0000-C000-000000000046');

/** A GUID as Windows lays it out in memory. */
function guid(text: string): Buffer {
  const hex = text.replaceAll('-', '');
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  buffer.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  buffer.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), 'hex').copy(buffer, 8);
  return buffer;
}

class WinRtError extends Error {}

const failed = (hresult: number): boolean => hresult < 0;
const hex = (hresult: number): string => `0x${(hresult >>> 0).toString(16).padStart(8, '0')}`;

/** Calls method `index` of the object `self` with `shape`. */
function vcall(self: unknown, index: number, shape: TypeObject, ...args: unknown[]): number {
  const table = koffi.decode(self, 'void *') as unknown;
  const method = koffi.decode(table, index * 8, 'void *') as unknown;
  return koffi.call(method, shape, self, ...args) as number;
}

function check(hresult: number, what: string): void {
  if (failed(hresult)) throw new WinRtError(`${what} failed (${hex(hresult)})`);
}

function getObject(self: unknown, index: number, what: string): unknown {
  const out: unknown[] = [null];
  check(vcall(self, index, GetObject, out), what);
  if (!out[0]) throw new WinRtError(`${what} gave nothing`);
  return out[0];
}

function release(self: unknown): void {
  if (self) vcall(self, AT.release, Release);
}

function hstring(text: string): unknown {
  const out: unknown[] = [null];
  check(windowsCreateString(text, text.length, out), 'WindowsCreateString');
  return out[0];
}

function readHstring(string: unknown): string {
  if (!string) return '';
  const length = [0];
  const raw = windowsGetStringRawBuffer(string, length);
  const size = length[0] ?? 0;
  return raw && size > 0 ? (koffi.decode(raw, 'char16_t', size) as string) : '';
}

let initialised = false;
function initialise(): void {
  if (initialised) return;
  initialised = true;
  // The main thread's apartment may be set up already (S_FALSE, RPC_E_CHANGED_MODE): fine either way.
  roInitialize(0);
}

/** Clipboard's statics (IClipboardStatics2); the caller releases them. */
function statics(): unknown {
  initialise();
  const name = 'Windows.ApplicationModel.DataTransfer.Clipboard';
  const classId = hstring(name);
  try {
    const out: unknown[] = [null];
    check(roGetActivationFactory(classId, IID_CLIPBOARD_STATICS_2, out), 'RoGetActivationFactory');
    return out[0];
  } finally {
    windowsDeleteString(classId);
  }
}

const ASYNC_COMPLETED = 1;
const ASYNC_STARTED = 0;
const ASYNC_TIMEOUT_MS = 3000;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for an IAsyncOperation to finish (polling its status, the main thread free meanwhile),
 * then reads its result with `read`; the operation is closed and released either way.
 */
async function awaitOperation<T>(
  operation: unknown,
  what: string,
  read: (operation: unknown) => T,
): Promise<T> {
  const info: unknown[] = [null];
  try {
    check(
      vcall(operation, AT.queryInterface, QueryInterface, IID_ASYNC_INFO, info),
      `${what}: IAsyncInfo`,
    );
    const started = Date.now();
    for (;;) {
      const status = [0];
      check(vcall(info[0], AT.asyncStatus, GetInt32, status), `${what}: status`);
      if (status[0] === ASYNC_COMPLETED) return read(operation);
      if (status[0] !== ASYNC_STARTED)
        throw new WinRtError(`${what} ended with status ${status[0]}`);
      if (Date.now() - started > ASYNC_TIMEOUT_MS) throw new WinRtError(`${what} timed out`);
      await wait(4);
    }
  } finally {
    if (info[0]) {
      vcall(info[0], AT.asyncClose, Close);
      release(info[0]);
    }
    release(operation);
  }
}

/** One item of the history: its text, or null when it isn't text (a picture, files). */
export interface ClipboardHistoryItem {
  /** When it was copied (ms since 1970). */
  readonly at: number;
  readonly text: string | null;
}

export type ClipboardHistoryRead =
  | { readonly kind: 'ok'; readonly items: readonly ClipboardHistoryItem[] }
  /** History is off in Windows (or turned off by the organisation). */
  | { readonly kind: 'off' }
  /** Windows refused: Flint wasn't in the foreground. */
  | { readonly kind: 'denied' }
  /** Something unexpected; `reason` says what (for the log). */
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Whether clipboard history is on in Windows; null when it can't be told. */
export function clipboardHistoryEnabled(): boolean | null {
  let clipboard: unknown = null;
  try {
    clipboard = statics();
    const enabled = [0];
    check(vcall(clipboard, AT.isHistoryEnabled, GetBool, enabled), 'IsHistoryEnabled');
    return enabled[0] !== 0;
  } catch {
    return null;
  } finally {
    release(clipboard);
  }
}

/** Windows' DateTime (100 ns since 1601) as ms since 1970. */
const fromDateTime = (ticks: bigint | number): number =>
  Number(BigInt(ticks) / 10_000n - 11_644_473_600_000n);

/** The newest `limit` items of Windows' clipboard history, newest first. */
export async function readClipboardHistory(limit = 25): Promise<ClipboardHistoryRead> {
  let clipboard: unknown = null;
  let result: unknown = null;
  let items: unknown = null;
  const textFormat = hstring('Text');
  try {
    clipboard = statics();
    const operation = getObject(clipboard, AT.getHistoryItemsAsync, 'GetHistoryItemsAsync');
    result = await awaitOperation(operation, 'GetHistoryItemsAsync', (done) =>
      getObject(done, AT.asyncGetResults, 'GetHistoryItemsAsync: results'),
    );
    const status = [0];
    check(vcall(result, AT.resultStatus, GetInt32, status), 'ClipboardHistoryItemsResult.Status');
    // ClipboardHistoryItemsResultStatus: Success, AccessDenied, ClipboardHistoryDisabled.
    if (status[0] === 1) return { kind: 'denied' };
    if (status[0] === 2) return { kind: 'off' };
    if (status[0] !== 0) return { kind: 'unavailable', reason: `status ${status[0]}` };
    items = getObject(result, AT.resultItems, 'ClipboardHistoryItemsResult.Items');
    const size = [0];
    check(vcall(items, AT.vectorSize, GetUint32, size), 'Items.Size');
    const read: ClipboardHistoryItem[] = [];
    for (let index = 0; index < Math.min(size[0] ?? 0, limit); index++) {
      read.push(await readItem(items, index, textFormat));
    }
    return { kind: 'ok', items: read };
  } catch (error) {
    return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    release(items);
    release(result);
    release(clipboard);
    windowsDeleteString(textFormat);
  }
}

async function readItem(
  items: unknown,
  index: number,
  textFormat: unknown,
): Promise<ClipboardHistoryItem> {
  const item: unknown[] = [null];
  let content: unknown = null;
  check(vcall(items, AT.vectorGetAt, GetAt, index, item), `Items.GetAt(${index})`);
  try {
    const ticks: (bigint | number)[] = [0];
    check(vcall(item[0], AT.itemTimestamp, GetInt64, ticks), 'Item.Timestamp');
    content = getObject(item[0], AT.itemContent, 'Item.Content');
    const isText = [0];
    check(vcall(content, AT.viewContains, ContainsFormat, textFormat, isText), 'Content.Contains');
    let text: string | null = null;
    if (isText[0] !== 0) {
      const operation = getObject(content, AT.viewGetTextAsync, 'GetTextAsync');
      text = await awaitOperation(operation, 'GetTextAsync', (done) => {
        const string: unknown[] = [null];
        check(vcall(done, AT.asyncGetResults, GetObject, string), 'GetTextAsync: results');
        try {
          return readHstring(string[0]);
        } finally {
          if (string[0]) windowsDeleteString(string[0]);
        }
      });
    }
    return { at: fromDateTime(ticks[0] ?? 0), text };
  } finally {
    release(content);
    release(item[0]);
  }
}
