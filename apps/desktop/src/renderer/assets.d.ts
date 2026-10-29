/** Vite turns imported images into URLs of the bundled file. */
declare module '*.svg' {
  const url: string;
  export default url;
}
