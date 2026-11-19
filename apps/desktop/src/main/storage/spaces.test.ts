import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpaceFolder, discoverSpaces, spaceFolderName } from './spaces.js';

/** SPACE-01, 04 §9: the spaces in `Spaces/`, and a new one made on disk. */
describe('spaces on disk (SPACE-01)', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'flint-spaces-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const seed = async (folder: string, text: string | null): Promise<void> => {
    await mkdir(join(base, 'Spaces', folder, '.flint'), { recursive: true });
    if (text !== null) await writeFile(join(base, 'Spaces', folder, '.flint', 'space.json'), text);
  };

  it('finds no spaces when there is no Spaces folder', async () => {
    expect(await discoverSpaces(base)).toEqual([]);
  });

  it('reads only folders with a valid space.json; others are left alone', async () => {
    await seed('Home', '{"flint":1,"id":"s-home1","name":"Home"}');
    await seed('Work', '{"flint":1,"id":"s-work1","name":"Work"}');
    await seed('Photos', null);
    await seed('Broken', 'not json');
    await writeFile(join(base, 'Spaces', 'notes.md'), '# not a space');
    const spaces = await discoverSpaces(base);
    expect(spaces.map((space) => [space.id, space.name])).toEqual([
      ['s-home1', 'Home'],
      ['s-work1', 'Work'],
    ]);
    expect(spaces[0]?.folder).toBe(join(base, 'Spaces', 'Home'));
  });

  it('a copied space folder claiming the same ID is left alone, the first one stays', async () => {
    await seed('Home', '{"flint":1,"id":"s-home1","name":"Home"}');
    await seed('Home - Copy', '{"flint":1,"id":"s-home1","name":"Home"}');
    const logged: string[] = [];
    const spaces = await discoverSpaces(base, (line) => logged.push(line));
    expect(spaces).toHaveLength(1);
    expect(logged).toHaveLength(1);
  });

  it('makes a space: its folder named after it, numbered when taken, space.json written', async () => {
    const home = await createSpaceFolder(base, '  Home ', 's-home1');
    expect(home?.folder).toBe(join(base, 'Spaces', 'Home'));
    const json = JSON.parse(
      await readFile(join(base, 'Spaces', 'Home', '.flint', 'space.json'), 'utf8'),
    ) as unknown;
    expect(json).toEqual({ flint: 1, id: 's-home1', name: 'Home' });
    const second = await createSpaceFolder(base, 'home', 's-home2');
    expect(second?.folder).toBe(join(base, 'Spaces', 'home 2'));
    expect((await discoverSpaces(base)).map((space) => space.id).sort()).toEqual([
      's-home1',
      's-home2',
    ]);
    expect(await createSpaceFolder(base, '   ', 's-blank1')).toBeNull();
  });

  it('a name Windows can’t use as a folder gets a safe one', () => {
    expect(spaceFolderName('Home', new Set())).toBe('Home');
    expect(spaceFolderName('Home', new Set(['HOME', 'Home 2']))).toBe('Home 3');
    expect(spaceFolderName('a/b', new Set())).toBe('Space');
    expect(spaceFolderName('CON', new Set())).toBe('Space');
  });
});
