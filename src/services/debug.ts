// Verbose logging module — output is only visible when Spicetify devtools are
// open (spicetify enable-devtools). Filter by tag in Chrome DevTools console,
// e.g. "[WL:player]" or just "[WL" to see all WaveLink messages.
//
// window.__wl is exposed at startup (extension.tsx) so you can inspect live
// state directly in the console without adding extra log calls.

const T = "color:#ff5500;font-weight:bold";
const R = "color:inherit;font-weight:normal";

export function log(tag: string, ...args: unknown[]): void {
  console.log(`%c[WL:${tag}]%c`, T, R, ...args);
}

export function warn(tag: string, ...args: unknown[]): void {
  console.warn(`%c[WL:${tag}]%c`, T, R, ...args);
}

export function error(tag: string, ...args: unknown[]): void {
  console.error(`%c[WL:${tag}]%c`, T, R, ...args);
}

export function group(tag: string): void {
  console.groupCollapsed(`%c[WL:${tag}]%c`, T, R);
}

export function groupEnd(): void {
  console.groupEnd();
}
