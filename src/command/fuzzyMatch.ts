/** Standard edit distance (single-character insert/delete/substitute). Used
 *  for typo-tolerant matching of both entity names and domain vocabulary --
 *  the player should not need to spell "Cambodia" or "mobilize" correctly. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/** 0..1 similarity, 1 = identical, normalized by the longer string's length
 *  so short and long words are held to comparable relative standards. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/** How much edit distance to tolerate for a word of this length -- short
 *  words need to match almost exactly (2 letters off on a 4-letter word is
 *  a different word), long words can absorb more typos. */
export function toleranceFor(length: number): number {
  if (length <= 4) return 1
  if (length <= 8) return 2
  return 3
}

export interface FuzzyCandidate<T> {
  value: T
  score: number
}

/** Finds the best fuzzy match(es) for `query` among `candidates` (compared
 *  via `key`). Returns candidates within `toleranceFor` of query's length,
 *  sorted best-first, so callers can detect a clear winner vs. a tie that
 *  needs disambiguation instead of guessing. */
export function fuzzyRank<T>(query: string, candidates: T[], key: (c: T) => string): FuzzyCandidate<T>[] {
  const q = query.toLowerCase()
  const tolerance = toleranceFor(q.length)
  const ranked: FuzzyCandidate<T>[] = []
  for (const candidate of candidates) {
    const k = key(candidate).toLowerCase()
    const dist = levenshtein(q, k)
    if (dist > Math.max(tolerance, toleranceFor(k.length))) continue
    ranked.push({ value: candidate, score: 1 - dist / Math.max(q.length, k.length) })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}
