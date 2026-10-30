/** Loading the browser entry point installs the classic bundle's global API. */
declare global {
  var TurboPascal: typeof import('./index.js');
}
export {};
