/**
 * SPACE-03 (D-189 Q4, D-190 Q21): the space's letter without React, for the capture popup's `##`
 * menu and the pickers (plain DOM): the square with the space's first letter, its name as the
 * tooltip (where it can't be clicked, the letter only names its space).
 */

/** A space's letter: the first letter of its name, upper case. */
export function spaceLetter(name: string): string {
  const first = [...name.trim()][0] ?? '?';
  return first.toLocaleUpperCase();
}

/** The letter's square (`.mm`, docs/09 §8) for a list in another space. */
export function spaceLetterElement(space: {
  readonly id: string;
  readonly name: string;
}): HTMLElement {
  const square = document.createElement('span');
  square.className = 'mm';
  square.dataset['space'] = space.id;
  square.title = space.name;
  square.setAttribute('aria-label', space.name);
  const cap = document.createElement('span');
  cap.className = 'cap';
  cap.textContent = spaceLetter(space.name);
  square.append(cap);
  return square;
}
