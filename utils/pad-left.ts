export function padLeft<T>(fullLen: number, arr: Array<T | null | undefined>): Array<T | null> {
  const pad = Array(Math.max(0, fullLen - arr.length)).fill(null);
  return pad.concat(arr as Array<T | null>);
}
