/** "1 skill", "13 skills". Words that add more than an "s" pass their plural. */
export function count(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
