/**
 * The WHATWG `URL` parser, which every runtime Flint runs on has (Node, Chromium, Hermes). Core's
 * build keeps Node and DOM types out (tsconfig.build.json), so the little it uses is typed here.
 */
export interface ParsedUrl {
  readonly protocol: string;
  readonly hostname: string;
  readonly pathname: string;
}

const UrlClass = (globalThis as unknown as { URL: new (url: string) => ParsedUrl }).URL;

/** Parses a URL; throws on an invalid one, as `new URL` does. */
export function parseUrl(url: string): ParsedUrl {
  return new UrlClass(url);
}
