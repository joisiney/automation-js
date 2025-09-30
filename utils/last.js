export function last(arr) {
  return arr.filter((x) => x !== null && x !== undefined).slice(-1)[0];
}