// scripts/build-cli.mjs loads these as text (esbuild's text loader).
declare module '*.txt' {
  const text: string;
  export default text;
}
declare module '*.yml' {
  const text: string;
  export default text;
}
