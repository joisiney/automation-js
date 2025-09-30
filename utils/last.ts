export function last<T>(arr: Array<T | null | undefined>): T | undefined {
  return arr.filter((x) => x !== null && x !== undefined).slice(-1)[0] as T | undefined;
}
