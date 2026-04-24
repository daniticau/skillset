/**
 * Minimal JSONL helpers shared by scrapers and the normalized session reader.
 * Scrapers typically want strict parsing (one bad line invalidates the file),
 * while the reader wants lenient parsing so a single malformed line does not
 * hide the rest of a session.
 */

export function parseJsonLinesStrict<T = unknown>(content: string): T[] | null {
  const records: T[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      return null;
    }
  }
  return records;
}

export function parseJsonLinesLenient<T = unknown>(content: string): T[] {
  const records: T[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      // Ignore malformed lines and keep the rest of the file readable.
    }
  }
  return records;
}
