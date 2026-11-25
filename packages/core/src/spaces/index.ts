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
