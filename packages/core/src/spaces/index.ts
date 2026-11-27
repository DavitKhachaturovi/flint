/** Spaces (SPACE-01 to SPACE-11, D-189, D-190): what needs no Electron, shared with the phone later. */
export {
  JOIN_NAME_MAX,
  JOIN_PAGE,
  cleanJoinName,
  findJoinAppLink,
  joinAppLink,
  joinPageLink,
  parseJoinAppLink,
  parseJoinPageLink,
  type GoogleJoin,
  type JoinRequest,
} from './join-link.js';
export {
  PERSONAL_SPACE,
  SPACE_ID,
  SPACE_NAME_MAX,
  cleanSpaceName,
  readSpaceFile,
  writeSpaceFile,
  type SpaceFile,
} from './space-file.js';
export {
  gmailComposeUrl,
  inviteEmail,
  isGmailAddress,
  mailtoUrl,
  type InviteEmail,
} from './invite.js';
export {
  PERSONAL_KEYS,
  applyPersonal,
  splitPersonal,
  type PersonalFields,
  type PersonalKey,
  type PersonalSplit,
} from './personal.js';
export {
  MINE_KEEP_DAYS,
  MINE_MAX_TASKS,
  mergeMine,
  mineFields,
  pruneMine,
  readMineFile,
  recordMine,
  writeMineFile,
  type MineEntry,
  type MineField,
  type MineFile,
  type MineRead,
} from './mine-file.js';
export {
  SpaceStoreError,
  type SpaceFileRef,
  type SpaceMember,
  type SpaceRevision,
  type SpaceStore,
  type SpaceStoreProblem,
} from './store.js';
export { FakeSpaceStore } from './fake-store.js';
export { WRITE_TRIES, writeSafely, type Merge3, type Written } from './write-safely.js';
export {
  crc32,
  readZip,
  writeZip,
  ZipError,
  type ZipCodec,
  type ZipEntry,
  type ZipLimits,
  type ZipProblem,
} from './zip.js';
export {
  SPACE_ARCHIVE_LIMITS,
  SPACE_META,
  SpaceArchiveError,
  readSpaceArchive,
  writeSpaceArchive,
  type SpaceArchive,
  type SpaceArchiveProblem,
  type SpaceMetaName,
} from './space-archive.js';
export { sha256 } from './sha256.js';
export {
  FILES_LIMITS,
  FILES_MAX_BYTES,
  FilesArchiveError,
  attachmentEntry,
  isAttachmentName,
  mergeFiles,
  pruneFiles,
  readFilesArchive,
  writeFilesArchive,
  type FilesArchive,
  type FilesProblem,
  type SpaceAttachment,
} from './files-archive.js';
export {
  NEVER_FROM_OTHERS,
  isSafeAttachmentName,
  isSafeFileName,
  isSafeLabel,
  nameTaken,
  windowsKeys,
} from './untrusted-names.js';
export { mergeSpaceLists, spaceMerge3, type SpaceListsMerge } from './space-merge.js';
export {
  spaceRound,
  type LocalSpace,
  type SpaceBase,
  type SpaceRoundOptions,
  type SpaceRoundReport,
} from './space-sync.js';
