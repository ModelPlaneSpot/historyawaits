const ONES: Record<string, number> = {
  zero: 0,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}

const BIG_MAGNITUDES: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
}

const SHORT_SUFFIXES: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }

/** Relative multipliers applied to a CURRENT value (see spec: "double",
 *  "triple", "reduce by half" mean something different from an absolute
 *  number, and only make sense in a rule that already knows what field
 *  they're being applied to). */
export const MULTIPLIER_WORDS: Record<string, number> = {
  half: 0.5,
  double: 2,
  triple: 3,
  quadruple: 4,
}

/** "one hundred thousand" / "a hundred thousand" / "100 thousand" / "two
 *  million" / plain digits mixed with word magnitudes ("and" is ignored so
 *  "one hundred and fifty" also works). Returns null if the phrase isn't a
 *  recognizable number at all (as opposed to 0, which is a valid parse of
 *  "zero"). */
function parseWordNumber(text: string): number | null {
  const tokens = text
    .replace(/,/g, '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
  let result = 0
  let current = 0
  let matchedAny = false

  for (const tok of tokens) {
    if (/^\d+(\.\d+)?$/.test(tok)) {
      current += Number(tok)
      matchedAny = true
    } else if (tok in ONES) {
      current += ONES[tok]
      matchedAny = true
    } else if (tok in TENS) {
      current += TENS[tok]
      matchedAny = true
    } else if (tok === 'hundred') {
      current = (current || 1) * 100
      matchedAny = true
    } else if (tok in BIG_MAGNITUDES) {
      result += (current || 1) * BIG_MAGNITUDES[tok]
      current = 0
      matchedAny = true
    } else if (tok === 'and') {
      continue
    } else if (matchedAny) {
      break // trailing non-number word (e.g. a unit noun the caller didn't strip) -- stop, don't fail
    } else {
      return null
    }
  }

  return matchedAny ? result + current : null
}

/** Parses any of: "100,000" / "100000" / "100k" / "1.5m" / "one hundred
 *  thousand" / "a hundred thousand" / "100 thousand" / "twenty" (for
 *  percentages). Returns null if the phrase isn't a number at all. */
export function parseAnyNumber(phrase: string): number | null {
  const trimmed = phrase.trim().toLowerCase()
  if (trimmed.length === 0) return null

  if (/^\d[\d,]*(\.\d+)?$/.test(trimmed)) return Number(trimmed.replace(/,/g, ''))

  const shortMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(k|m|b)$/)
  if (shortMatch) return Number(shortMatch[1]) * SHORT_SUFFIXES[shortMatch[2]]

  return parseWordNumber(trimmed)
}
