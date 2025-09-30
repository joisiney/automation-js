export function padLeft(fullLen, arr) {
  const pad = Array(Math.max(0, fullLen - arr.length)).fill(null);
  return pad.concat(arr);
}