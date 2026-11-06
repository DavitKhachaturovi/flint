/** Vite turns imported images into URLs of the bundled file. */
declare module '*.svg' {
  const url: string;
  export default url;
}
/** APP-15, D-117: a markdown file bundled as text (What's new reads `docs/whats-new.md`). */
declare module '*.md?raw' {
  const text: string;
  export default text;
}
