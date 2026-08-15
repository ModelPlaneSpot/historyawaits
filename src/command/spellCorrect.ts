import { levenshtein } from './fuzzyMatch'

/** Stricter than the general-purpose entity-matching tolerance -- every
 *  real typo this needs to fix (atack/invde/moblize/millitary/spendng/...)
 *  is a single character off, and a wider tolerance starts colliding with
 *  unrelated real words (e.g. "ready" is 2 edits from "treaty"). */
function correctionTolerance(length: number): number {
  return length <= 6 ? 1 : 2
}

/** Domain vocabulary the fallback parser's regex rules key off of --
 *  deliberately verbs/nouns of the command language, NOT geography, so this
 *  pass never risks "correcting" a country name (entity typos are handled
 *  separately, by fuzzy entity resolution in entityResolver.ts). */
const VOCABULARY = [
  'declare',
  'war',
  'invade',
  'invasion',
  'attack',
  'launch',
  'offensive',
  'operations',
  'propose',
  'negotiate',
  'peace',
  'talks',
  'ceasefire',
  'fight',
  'fighting',
  'start',
  'mobilize',
  'demobilize',
  'recruit',
  'military',
  'readiness',
  'ready',
  'troops',
  'soldiers',
  'personnel',
  'border',
  'frontier',
  'establish',
  'base',
  'increase',
  'decrease',
  'reduce',
  'raise',
  'lower',
  'cut',
  'hike',
  'spending',
  'percent',
  'percentage',
  'thousand',
  'million',
  'billion',
  'build',
  'tank',
  'tanks',
  'aircraft',
  'plane',
  'planes',
  'jet',
  'jets',
  'fighter',
  'fighters',
  'ship',
  'ships',
  'warship',
  'warships',
  'artillery',
  'gun',
  'guns',
  'withdraw',
  'return',
  'annex',
  'capture',
  'seize',
  'cede',
  'grant',
  'independence',
  'liberate',
  'release',
  'sign',
  'treaty',
  'pact',
  'agreement',
  'defense',
  'defence',
  'alliance',
  'break',
  'recognize',
  'recognition',
  'improve',
  'relations',
  'sanctions',
  'sanction',
  'impose',
  'lift',
  'aid',
  'deploy',
  'reposition',
  'redeploy',
  'tax',
  'taxes',
  'research',
  'technology',
  'dissolve',
  'disband',
  'election',
  'government',
  'economy',
  'infrastructure',
  'population',
]
const VOCABULARY_SET = new Set(VOCABULARY)

/** Concatenations that aren't standard English words but are common enough
 *  typed as one word ("peacetalks") to be worth splitting before the
 *  per-word correction pass runs. */
const COMPOUND_SPLITS: [RegExp, string][] = [
  [/\bpeacetalks\b/gi, 'peace talks'],
  [/\bceasefire\b/gi, 'cease fire'],
]

export function correctWord(word: string): string {
  const lower = word.toLowerCase()
  if (VOCABULARY_SET.has(lower) || lower.length < 4) return word

  let best: string | null = null
  let bestDist = Infinity
  for (const vocab of VOCABULARY) {
    if (Math.abs(vocab.length - lower.length) > 3) continue
    const dist = levenshtein(lower, vocab)
    if (dist < bestDist) {
      bestDist = dist
      best = vocab
    }
  }
  if (best && bestDist > 0 && bestDist <= correctionTolerance(lower.length)) return best
  return word
}

/** Best-effort typo correction over the domain vocabulary only -- run this
 *  BEFORE the regex rules so "atack iran" / "moblize 100k" / "increse
 *  millitary spendng" still match the same patterns a correctly-spelled
 *  command would. Never touches short words or words already recognized. */
export function correctText(text: string): string {
  let result = text
  for (const [pattern, replacement] of COMPOUND_SPLITS) result = result.replace(pattern, replacement)

  return result
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s*$/.test(token)) return token
      const m = token.match(/^([A-Za-z']+)([^A-Za-z']*)$/)
      if (!m) return token
      return correctWord(m[1]) + m[2]
    })
    .join('')
}
