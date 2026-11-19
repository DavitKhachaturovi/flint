/**
 * SPACE-01 (D-190 Q20): the list a picture or file added now belongs to: the main window's open
 * list. The main process saves it in that list's space's `attachments/`, so a space's attachments
 * travel with the space; with none (Today, Focus) it goes to the Flint folder's, as before.
 */
let current: string | null = null;

export function setAttachTarget(listId: string | null): void {
  current = listId;
}

export function attachTarget(): string | null {
  return current;
}
