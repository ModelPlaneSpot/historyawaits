import type { StructuredAction, StructuredPlan, TreatyKind, UnitType } from '@/domain/schemas'
import type { CommandParser, ParseContext } from './types'
import {
  buildResolverIndex,
  resolveEntity,
  resolveOrganization,
  resolveRegionOrOrganizationOrEntity,
  type ResolverIndex,
  type ResolveResult,
} from './entityResolver'
import { correctText } from './spellCorrect'
import { parseAnyNumber, MULTIPLIER_WORDS } from './numberParser'
import { isQuestion } from './intentClassifier'

function emptyAction(overrides: Partial<StructuredAction>): StructuredAction {
  return {
    actor: '',
    action: 'unknown',
    target: null,
    organization: null,
    treatyType: null,
    quantity: null,
    unit: null,
    percent: null,
    note: null,
    ...overrides,
  }
}

const UNIT_WORDS: Record<string, UnitType> = {
  troop: 'troops',
  troops: 'troops',
  soldier: 'troops',
  soldiers: 'troops',
  tank: 'tanks',
  tanks: 'tanks',
  ifv: 'tanks',
  ifvs: 'tanks',
  apc: 'tanks',
  apcs: 'tanks',
  aircraft: 'aircraft',
  plane: 'aircraft',
  planes: 'aircraft',
  jet: 'aircraft',
  jets: 'aircraft',
  fighter: 'aircraft',
  fighters: 'aircraft',
  ship: 'ships',
  ships: 'ships',
  warship: 'ships',
  warships: 'ships',
  artillery: 'artillery',
  gun: 'artillery',
  guns: 'artillery',
  sam: 'artillery',
  sams: 'artillery',
}

const TREATY_WORDS: [RegExp, TreatyKind][] = [
  [/defen[cs]e (pact|treaty|agreement)/i, 'defense_pact'],
  [/trade (agreement|deal|treaty)/i, 'trade_agreement'],
  [/peace treaty/i, 'peace_treaty'],
  [/non-?aggression/i, 'non_aggression'],
]

// ---------------------------------------------------------------------------
// Build-result helpers: every rule below produces either a successful
// partial action (optionally flagged "fuzzy" when it leaned on typo
// correction or approximate entity matching, which lowers confidence and
// may trigger a confirm-before-executing step), or a clarification request
// when a name was genuinely ambiguous ("did you mean X or Y?" -- never a
// guess), or null (rule didn't match).
// ---------------------------------------------------------------------------
interface BuildSuccess {
  partial: Partial<StructuredAction>
  fuzzy?: boolean
}
interface BuildClarify {
  clarification: string
}
type BuildOutcome = BuildSuccess | BuildClarify | null

function ok(partial: Partial<StructuredAction>, fuzzy = false): BuildSuccess {
  return { partial, fuzzy }
}
function clarify(question: string): BuildClarify {
  return { clarification: question }
}
function isClarify<T>(x: T | BuildClarify): x is BuildClarify {
  return !!x && typeof x === 'object' && 'clarification' in x
}

function ambiguityQuestion(r: ResolveResult): string {
  return `I found more than one possible match -- did you mean ${r.alternatives.map((n) => `"${n}"`).join(' or ')}?`
}

/** Wraps a ResolveResult into a target-bearing BuildOutcome fragment, or a
 *  clarification question if the name was ambiguous, or null if genuinely
 *  not found (so the rule can fall through to "didn't recognize"). */
function targetOutcome(r: ResolveResult): { target: string | null; fuzzy: boolean } | BuildClarify | null {
  if (r.ambiguous) return clarify(ambiguityQuestion(r))
  if (r.id === null) return null
  return { target: r.id, fuzzy: r.confidence < 1 }
}

const REGION_PRONOUNS = /^(this region|here|this territory|this area)$/i
const CONTEXT_REGION_PRONOUNS = /^(there|that region|that area)$/i
const CONTEXT_ENTITY_PRONOUNS = /^(them|that country|the enemy|their|its|him|her)$/i
const GENERIC_IT = /^it$/i

/** Resolves a region reference, understanding "this region"/"here" (the
 *  player's current map selection), "there"/"that region" (whatever region
 *  the previous command was about), and otherwise falls through to normal
 *  name resolution (exact, then fuzzy/typo-tolerant). */
function resolveRegionLike(text: string, ctx: ParseContext, index: ResolverIndex): ResolveResult {
  const t = text.trim()
  if (REGION_PRONOUNS.test(t)) {
    return ctx.selectedRegionId
      ? { id: ctx.selectedRegionId, kind: 'region', confidence: 1, ambiguous: false, alternatives: [] }
      : { id: null, kind: 'region', confidence: 0, ambiguous: false, alternatives: [] }
  }
  if (CONTEXT_REGION_PRONOUNS.test(t) || (GENERIC_IT.test(t) && ctx.lastRegionId)) {
    return ctx.lastRegionId
      ? { id: ctx.lastRegionId, kind: 'region', confidence: 0.85, ambiguous: false, alternatives: [] }
      : { id: null, kind: 'region', confidence: 0, ambiguous: false, alternatives: [] }
  }
  return resolveRegionOrOrganizationOrEntity(text, index)
}

/** Same idea as resolveRegionLike but for country/entity references --
 *  "them"/"that country"/"the enemy" resolve against whatever entity the
 *  previous command targeted. */
function resolveEntityLike(text: string, ctx: ParseContext, index: ResolverIndex): ResolveResult {
  const t = text.trim()
  if (CONTEXT_ENTITY_PRONOUNS.test(t) || (GENERIC_IT.test(t) && ctx.lastEntityId)) {
    return ctx.lastEntityId
      ? { id: ctx.lastEntityId, kind: 'entity', confidence: 0.85, ambiguous: false, alternatives: [] }
      : { id: null, kind: 'entity', confidence: 0, ambiguous: false, alternatives: [] }
  }
  return resolveEntity(text, index)
}

/** Declare-war target resolution: same as resolveEntityLike, but if no
 *  country matches, also tries organizations and the regions they control
 *  (e.g. "Hamas" / "Gaza") so the validator can explain why a state-to-state
 *  war doesn't apply to a non-state actor -- instead of the resolver
 *  pretending the name doesn't exist at all when it plainly does. */
function resolveWarTarget(text: string, ctx: ParseContext, index: ResolverIndex): ResolveResult {
  const entityResult = resolveEntityLike(text, ctx, index)
  if (entityResult.id !== null || entityResult.ambiguous) return entityResult
  return resolveRegionOrOrganizationOrEntity(text, index)
}

function currentEntity(ctx: ParseContext) {
  return ctx.worldState.entities[ctx.playerEntityId]
}

/** Parses a captured number phrase (digits, "100k", or word-numbers) or, if
 *  it's a bare multiplier word ("double"/"half"/"triple"), applies it to
 *  `current`. Returns null if the phrase isn't recognizable at all. */
function resolveNumberPhrase(phrase: string, current?: number): number | null {
  const trimmed = phrase.trim().toLowerCase()
  const multiplier = MULTIPLIER_WORDS[trimmed]
  if (multiplier !== undefined && current !== undefined) return current * multiplier
  return parseAnyNumber(phrase)
}

type Rule = {
  pattern: RegExp
  build: (m: RegExpMatchArray, index: ResolverIndex, ctx: ParseContext) => BuildOutcome
}

const RULES: Rule[] = [
  {
    pattern: /^(?:end|next)\s+turn$/i,
    build: () => ok({ action: 'end_turn' }),
  },

  // --- Preparation vs. execution (spec: "prepare" must NOT auto-declare war) ---
  {
    pattern: /prepar\w*\s+(?:us|our\s+(?:military|forces|army|nation|country))?\s*for\s+(?:a\s+)?(?:possible\s+|potential\s+|major\s+)?war(?:\s+with\s+(.+))?/i,
    build: (m, _idx, ctx) => {
      const target = m[1]?.trim()
      const entity = currentEntity(ctx)
      const percent = Math.min(100, entity.military.mobilizationLevel + 20)
      return ok(
        {
          action: 'set_readiness',
          percent,
          note: target ? `Preparing for possible conflict with ${target} -- readiness raised, not a declaration of war.` : 'Preparing for possible conflict -- readiness raised, not a declaration of war.',
        },
        false,
      )
    },
  },
  {
    pattern: /prepar\w*\s+(?:an?\s+)?invasion\s+of\s+(.+)/i,
    build: (_m, _idx, ctx) => {
      const entity = currentEntity(ctx)
      const percent = Math.min(100, entity.military.mobilizationLevel + 25)
      return ok({
        action: 'set_readiness',
        percent,
        note: `Invasion preparations underway -- forces are massing, but no war has been declared. Say "attack" or "launch the invasion" to actually go to war.`,
      })
    },
  },
  {
    pattern: /(?:want|need)\s+(?:our\s+)?(?:army|military|forces)\s+ready\s+for\s+something\s+big|get\s+(?:our\s+)?(?:army|military|forces)\s+ready|gear\s+up\s+the\s+(?:army|military)/i,
    build: (_m, _idx, ctx) => {
      const entity = currentEntity(ctx)
      return ok({ action: 'set_readiness', percent: Math.min(100, entity.military.mobilizationLevel + 20) })
    },
  },

  // --- Military: declarations of war ---
  {
    pattern: /(?:declare war on|invade|attack|launch\s+(?:the\s+)?invasion of|launch (?:an? )?(?:military )?offensive against|begin military operations against)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveWarTarget(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'declare_war', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /(?:hit|strike)\s+(?:the\s+)?(?:military bases|bases|targets|military installations) of\s+(.+)|(?:hit|strike)\s+(their|its|them)\s+(?:military bases|bases|targets|military installations)/i,
    build: (m, idx, ctx) => {
      const raw = m[1] ?? m[2]
      const r = targetOutcome(resolveWarTarget(raw, ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok(
        { action: 'declare_war', target: r.target, note: 'This simulation does not target individual facilities -- interpreted as a military strike (an act of war).' },
        true,
      )
    },
  },

  // --- Military: peace ---
  {
    pattern: /(?:start|begin)\s+peace\s+talks(?:\s+with\s+(.+))?|stop\s+fighting(?:\s+with\s+(.+))?|cease\s*fire(?:\s+with\s+(.+))?|end (?:the )?war(?: with (.+))?|(?:propose|make|seek|negotiate|start) peace(?: with (.+))?/i,
    build: (m, idx, ctx) => {
      const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]
      if (!raw) return ok({ action: 'propose_peace', target: null })
      const r = targetOutcome(resolveEntityLike(raw, ctx, idx))
      if (!r) return ok({ action: 'propose_peace', target: null })
      if (isClarify(r)) return r
      return ok({ action: 'propose_peace', target: r.target }, r.fuzzy)
    },
  },

  // --- Military: mobilization / demobilization / readiness ---
  {
    pattern: /(?:mobilize|call up|raise|recruit)\s+(.+?)\s*(?:troops|soldiers)?$/i,
    build: (m) => {
      const qty = resolveNumberPhrase(m[1])
      if (qty === null) return null
      return ok({ action: 'mobilize', quantity: qty, unit: 'troops' })
    },
  },
  {
    pattern: /demobilize\s+(.+?)\s*(?:troops|soldiers)?$/i,
    build: (m) => {
      const qty = resolveNumberPhrase(m[1])
      if (qty === null) return null
      return ok({ action: 'demobilize', quantity: qty, unit: 'troops' })
    },
  },
  {
    pattern: /make\s+the\s+(?:army|military)\s+(?:much\s+)?bigger|grow\s+the\s+(?:army|military)|expand\s+(?:the\s+)?(?:army|military)|(?:need|want)\s+(?:a\s+)?(?:much\s+)?(?:bigger|larger)\s+(?:army|military)/i,
    build: (_m, _idx, ctx) => {
      const entity = currentEntity(ctx)
      const qty = Math.max(20000, Math.round(entity.military.personnelActive * 0.1))
      return ok({ action: 'mobilize', quantity: qty, unit: 'troops', note: `Assumed an increase of ${qty.toLocaleString()} troops -- specify a number for a different amount.` }, true)
    },
  },
  {
    pattern: /(?:set|raise|increase|reduce|lower)\s+(?:military\s+)?readiness\s+(?:to\s+)?(.+)/i,
    build: (m, _idx, ctx) => {
      const val = resolveNumberPhrase(m[1], currentEntity(ctx).military.mobilizationLevel)
      if (val === null) return null
      return ok({ action: 'set_readiness', percent: val })
    },
  },

  // --- Military: positioning (honestly unsupported -- no border-level troop tracking) ---
  {
    pattern: /(?:move|reposition|redeploy|deploy|send|put|get)\s+(?:[\d,]+\s*(?:troops|soldiers)|them|it|the troops|those troops|troops|soldiers|more soldiers|more troops)?\s*(?:to|toward|towards|near)?\s*(?:the\s+)?(?:northern|southern|eastern|western|north|south|east|west|.+?\s*(?:border|front|frontier))/i,
    build: () =>
      ok({
        action: 'unsupported',
        note: 'Troop positioning along specific borders/directions is not tracked by this simulation. Overall mobilization and readiness are -- try "mobilize" or "set readiness" instead.',
      }),
  },
  {
    pattern: /establish\s+(?:a\s+)?(?:military\s+)?base/i,
    build: () =>
      ok({
        action: 'unsupported',
        note: 'Military bases are not modeled as discrete objects in this simulation. Military presence is reflected through mobilization, readiness, and unit counts instead.',
      }),
  },

  // --- Military: spending ---
  {
    pattern: /(increase|raise|hike)\s+military\s+spending\s+by\s+(.+)/i,
    build: (m, _idx, ctx) => {
      const current = currentEntity(ctx).economy.militarySpendingPctOfGdp
      const delta = parseAnyNumber(m[2])
      if (delta === null) return null
      return ok({ action: 'set_military_spending', percent: current + delta })
    },
  },
  {
    pattern: /(reduce|decrease|lower|cut)\s+military\s+spending\s+by\s+(.+)/i,
    build: (m, _idx, ctx) => {
      const current = currentEntity(ctx).economy.militarySpendingPctOfGdp
      const delta = parseAnyNumber(m[2])
      if (delta === null) return null
      return ok({ action: 'set_military_spending', percent: current - delta })
    },
  },
  {
    pattern: /(?:double|triple)\s+military\s+spending/i,
    build: (m, _idx, ctx) => {
      const current = currentEntity(ctx).economy.militarySpendingPctOfGdp
      const mult = MULTIPLIER_WORDS[m[0].split(/\s+/)[0].toLowerCase()]
      return ok({ action: 'set_military_spending', percent: current * mult })
    },
  },
  {
    pattern: /(increase|raise|set|reduce|decrease|lower|cut)\s+military\s+spending\s+(?:to\s+)?(.+)/i,
    build: (m) => {
      const val = parseAnyNumber(m[2])
      if (val === null) return null
      return ok({ action: 'set_military_spending', percent: val })
    },
  },
  {
    pattern: /(?:increase|raise|hike)\s+military\s+spending\s*$/i,
    build: (_m, _idx, ctx) => ok({ action: 'set_military_spending', percent: Math.min(100, currentEntity(ctx).economy.militarySpendingPctOfGdp + 2) }),
  },
  {
    pattern: /(?:reduce|decrease|lower|cut)\s+military\s+spending\s*$/i,
    build: (_m, _idx, ctx) => ok({ action: 'set_military_spending', percent: Math.max(0, currentEntity(ctx).economy.militarySpendingPctOfGdp - 2) }),
  },
  {
    pattern: /spend\s+more\s+(?:money\s+)?on\s+(?:the\s+)?(?:armed forces|military|defense|defence)/i,
    build: (_m, _idx, ctx) => ok({ action: 'set_military_spending', percent: Math.min(100, currentEntity(ctx).economy.militarySpendingPctOfGdp + 2) }),
  },

  // --- Military: procurement ---
  {
    pattern: /build\s+(.+?)\s*(troops?|soldiers?|tanks?|ifvs?|apcs?|aircraft|planes?|jets?|fighters?|ships?|warships?|artillery|sams?|guns?)/i,
    build: (m) => {
      const qty = resolveNumberPhrase(m[1])
      if (qty === null) return null
      const unitWord = m[2].toLowerCase().replace(/s$/, '')
      return ok({ action: 'build_units', quantity: qty, unit: UNIT_WORDS[unitWord] ?? UNIT_WORDS[m[2].toLowerCase()] ?? 'troops' })
    },
  },
  {
    pattern: /(?:we\s+need|need)\s+more\s+(tanks?|ifvs?|apcs?|aircraft|planes?|jets?|fighters?|ships?|warships?|artillery|sams?)/i,
    build: (m) => {
      const unitWord = m[1].toLowerCase().replace(/s$/, '')
      const unit = UNIT_WORDS[unitWord] ?? UNIT_WORDS[m[1].toLowerCase()] ?? 'tanks'
      return ok({ action: 'build_units', quantity: 20, unit, note: `Assumed procurement of 20 ${unit} -- specify a number for a different amount.` }, true)
    },
  },

  // --- Territory ---
  {
    pattern: /(?:withdraw\s+(?:troops\s+)?from|return|give back|hand back|get\s+(?:our\s+)?(?:forces|troops)\s+out\s+of|pull\s+out\s+of)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveRegionLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      const region = r.target ? ctx.worldState.regions[r.target] : null
      return ok({ action: 'cede_territory', target: r.target, organization: region?.countryId ?? null }, r.fuzzy)
    },
  },
  {
    pattern: /(?:annex|capture|seize)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveRegionLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'annex', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /(?:want|take)\s+the\s+territory\s+(?:on|across|beyond)\s+the\s+(?:other\s+side\s+of\s+the\s+)?border/i,
    build: (_m, _idx, ctx) => {
      if (ctx.selectedRegionId) return ok({ action: 'annex', target: ctx.selectedRegionId })
      return clarify('Which region or territory do you mean? Click it on the map, or name it.')
    },
  },
  {
    pattern: /cede\s+(.+?)\s+to\s+(.+)/i,
    build: (m, idx, ctx) => {
      const region = targetOutcome(resolveRegionLike(m[1], ctx, idx))
      if (!region) return null
      if (isClarify(region)) return region
      const to = targetOutcome(resolveEntityLike(m[2], ctx, idx))
      if (!to) return null
      if (isClarify(to)) return to
      return ok({ action: 'cede_territory', target: region.target, organization: to.target }, region.fuzzy || to.fuzzy)
    },
  },
  {
    pattern: /(?:grant independence to|release|liberate)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveRegionLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'grant_independence', target: r.target }, r.fuzzy)
    },
  },

  // --- Diplomacy ---
  {
    pattern: /make\s+(.+?)\s+our\s+(?:closest\s+)?(?:military\s+)?(ally|allies|partner|buddy|friend)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      const strong = /ally|allies|partner/i.test(m[2])
      return ok({ action: strong ? 'form_alliance' : 'improve_relations', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /(?:we need|i want|get)\s+(.+?)\s+on our side/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'improve_relations', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /sign\s+(?:a\s+)?(.*?)\s*(?:treaty|pact|agreement)?\s*with\s+(.+)/i,
    build: (m, idx, ctx) => {
      let treatyType: TreatyKind = 'non_aggression'
      for (const [re, kind] of TREATY_WORDS) {
        if (re.test(m[0])) {
          treatyType = kind
          break
        }
      }
      const r = targetOutcome(resolveEntityLike(m[2], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'sign_treaty', target: r.target, treatyType }, r.fuzzy)
    },
  },
  {
    pattern: /form\s+(?:an\s+)?alliance\s+with\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'form_alliance', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /break\s+(?:the\s+)?alliance\s+with\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'break_alliance', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /recognize\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'recognize', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /withdraw\s+recognition\s+(?:of|from)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'withdraw_recognition', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /improve\s+relations\s+with\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'improve_relations', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /lift\s+sanctions?\s+(?:on\s+)?(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'lift_sanction', target: r.target }, r.fuzzy)
    },
  },
  {
    pattern: /(?:impose\s+)?sanctions?\s+(?:on\s+)?(.+)|shut\s+down\s+imports\s+from\s+(.+)|(?:ban|restrict|cut off)\s+(?:imports|trade)\s+(?:from|with)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const raw = m[1] ?? m[2] ?? m[3]
      const r = targetOutcome(resolveEntityLike(raw, ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      const isImportPhrase = m[2] !== undefined || m[3] !== undefined
      return ok(
        {
          action: 'sanction',
          target: r.target,
          note: isImportPhrase ? 'Interpreted as economic sanctions -- this simulation does not model individual trade flows separately.' : null,
        },
        r.fuzzy || isImportPhrase,
      )
    },
  },
  {
    pattern: /send\s+(?:military\s+)?aid\s+to\s+(.+)/i,
    build: (m, idx, ctx) => {
      const r = targetOutcome(resolveEntityLike(m[1], ctx, idx))
      if (!r) return null
      if (isClarify(r)) return r
      return ok({ action: 'send_aid', target: r.target }, r.fuzzy)
    },
  },

  // --- Economy ---
  {
    pattern: /(increase|raise|hike)\s+tax(?:es)?\s+by\s+(.+)/i,
    build: (m, _idx, ctx) => {
      const current = currentEntity(ctx).economy.taxRatePct
      const delta = parseAnyNumber(m[2])
      if (delta === null) return null
      return ok({ action: 'set_tax_rate', percent: current + delta })
    },
  },
  {
    pattern: /(reduce|decrease|lower|cut)\s+tax(?:es)?\s+by\s+(.+)/i,
    build: (m, _idx, ctx) => {
      const current = currentEntity(ctx).economy.taxRatePct
      const delta = parseAnyNumber(m[2])
      if (delta === null) return null
      return ok({ action: 'set_tax_rate', percent: current - delta })
    },
  },
  {
    pattern: /(?:cut|reduce|lower)\s+tax(?:es)?\s+(?:by\s+)?half/i,
    build: (_m, _idx, ctx) => ok({ action: 'set_tax_rate', percent: currentEntity(ctx).economy.taxRatePct * 0.5 }),
  },
  {
    pattern: /(?:double|triple)\s+tax(?:es)?/i,
    build: (m, _idx, ctx) => {
      const mult = MULTIPLIER_WORDS[m[0].split(/\s+/)[0].toLowerCase()]
      return ok({ action: 'set_tax_rate', percent: Math.min(80, currentEntity(ctx).economy.taxRatePct * mult) })
    },
  },
  {
    pattern: /(?:set|increase|raise|reduce|decrease|lower)\s+tax(?:es)?\s+(?:rate\s+)?(?:to\s+)?(.+)/i,
    build: (m) => {
      const val = parseAnyNumber(m[1])
      if (val === null) return null
      return ok({ action: 'set_tax_rate', percent: val })
    },
  },
  {
    pattern: /(?:fix|improve|strengthen|boost)\s+(?:the\s+|our\s+)?economy|make\s+(?:the\s+|our\s+)?economy\s+(?:stronger|better)/i,
    build: () =>
      ok({
        action: 'unsupported',
        note: 'The economy is not a single lever -- try a specific policy: adjust the tax rate, change military spending, or fund research (e.g. "set tax rate to 20 percent").',
      }),
  },
  {
    pattern: /(?:don'?t\s+want\s+to\s+)?depend(?:ent)?\s+on\s+foreign\s+(\w+)|reduce\s+(?:our\s+)?dependence\s+on\s+foreign\s+(\w+)/i,
    build: (m) =>
      ok({
        action: 'unsupported',
        note: `This simulation does not model a specific ${m[1] ?? m[2]} import/dependency system -- the closest available levers are research funding, tax rate, and sanctions/trade policy toward specific suppliers.`,
      }),
  },

  // --- Research ---
  {
    pattern: /(?:start\s+)?research(?:ing)?\s+(.+)/i,
    build: (m) => ok({ action: 'research_tech', note: m[1].trim() }),
  },

  // --- Politics / organizations ---
  {
    pattern: /^(?:dissolve|disband)\s+(.+)/i,
    build: (m, idx) => {
      const r = resolveOrganization(m[1], idx)
      if (r.ambiguous) return clarify(ambiguityQuestion(r))
      if (r.id === null) return null
      return ok({ action: 'dissolve_organization', organization: r.id }, r.confidence < 1)
    },
  },
  {
    pattern: /(?:call|hold)\s+(?:a\s+)?(?:snap\s+)?election/i,
    build: () => ok({ action: 'call_election' }),
  },
]

// ---------------------------------------------------------------------------
// Negation ("don't attack Iran") -- acknowledge without executing. Detected
// BEFORE the rules above run, on the clause with the negation marker
// stripped, so we can still describe (honestly, without doing it) what was
// being negated.
// ---------------------------------------------------------------------------
const NEGATION_LEAD = /^(?:don'?t|do\s+not|never|avoid|prevent(?:ing)?)\s+/i
const STOP_CANCEL_LEAD = /^(?:stop|cancel)\s+(.+)/i

function describeNegated(clause: string, index: ResolverIndex, ctx: ParseContext): string {
  const inner = parseClause(clause, index, ctx)
  if (inner && !('clarification' in inner)) {
    const a = inner.partial.action
    if (a && a !== 'unknown' && a !== 'unsupported') return `${a.replace(/_/g, ' ')}`
  }
  return clause.trim()
}

// ---------------------------------------------------------------------------
// Compound-command clause splitting.
// ---------------------------------------------------------------------------
const LEAD_VERBS =
  'declare|invade|attack|launch|begin|prepar\\w*|propose|make|seek|negotiate|start|stop|cease|end the war|mobilize|call up|recruit|demobilize|grow|expand|build|annex|capture|seize|withdraw|return|give back|hand back|get|pull|cede|grant|release|liberate|sign|form|break|recognize|improve relations|lift sanctions|sanction|impose sanctions|shut down|ban|restrict|cut off|send|want|need|set|increase|raise|hike|reduce|decrease|lower|cut|double|triple|spend|establish|move|reposition|redeploy|deploy|put|research|dissolve|disband|call an election|hold an election|call a snap election|fix|improve|strengthen|boost|gear up'
const CLAUSE_SPLIT = new RegExp(
  `\\s*(?:,\\s*)?(?:and then|and|then)\\s+(?=(?:${LEAD_VERBS})\\b)` +
    `|,\\s+(?=(?:${LEAD_VERBS})\\b)` +
    `|;\\s*(?=\\S)`,
  'gi',
)

function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim().replace(/[.!?]+$/, '').trim())
    .filter(Boolean)
}

function parseClause(text: string, index: ResolverIndex, ctx: ParseContext): BuildOutcome {
  for (const rule of RULES) {
    const match = text.match(rule.pattern)
    if (!match) continue
    const outcome = rule.build(match, index, ctx)
    if (outcome) return outcome
  }
  return null
}

interface ParsedStep {
  action: StructuredAction
  fuzzy: boolean
}

/** Splits an "actually, I meant X" / "sorry I meant X" self-correction out
 *  of the input. If the trailing clause is a complete command on its own, it
 *  simply replaces everything before it. If it's just a bare name (the
 *  common case -- "attack Iran, actually I meant Iraq"), the name replaces
 *  the target of the last thing parsed before the correction marker. */
const CORRECTION_MARK = /\b(?:actually|i mean|i meant|sorry,?\s*i meant|no wait|scratch that)\b/i

function splitCorrection(input: string): { before: string; after: string } | null {
  const match = input.match(CORRECTION_MARK)
  if (!match || match.index === undefined) return null
  const before = input.slice(0, match.index).trim().replace(/[-,.\s]+$/, '')
  const after = input
    .slice(match.index + match[0].length)
    .trim()
    .replace(/^[-,.\s]+/, '')
  if (!before || !after) return null
  return { before, after }
}

export class FallbackParser implements CommandParser {
  readonly id = 'fallback' as const

  isAvailable(): boolean {
    return true
  }

  async parse(input: string, ctx: ParseContext): Promise<import('@/domain/schemas').ParseResult> {
    if (isQuestion(input)) {
      return {
        ok: false,
        plan: null,
        confidence: 0.9,
        raw: input,
        error: "That reads as a question, not an instruction -- ask the AI Advisor (top bar) for analysis, or phrase it as a command (e.g. \"attack Iran\") to execute it.",
        clarificationQuestion: null,
        interpretedSummary: null,
      }
    }

    const index = buildResolverIndex(ctx.worldState)
    const correction = splitCorrection(input)

    let workingInput = input
    let correctionOverride: { entityText: string } | null = null
    if (correction) {
      const afterOutcome = parseClause(correctText(correction.after), index, ctx)
      if (afterOutcome && !('clarification' in afterOutcome) && afterOutcome.partial.action && afterOutcome.partial.action !== 'unknown') {
        // The correction is itself a full command -- it replaces everything before it.
        workingInput = correction.after
      } else {
        // Bare replacement name -- keep the earlier clause(s) but swap in the new target later.
        workingInput = correction.before
        correctionOverride = { entityText: correction.after }
      }
    }

    const corrected = correctText(workingInput)
    const anySpellingFixed = corrected.toLowerCase() !== workingInput.toLowerCase()
    const clauses = splitClauses(corrected)
    const steps: ParsedStep[] = []
    let clarificationQuestion: string | null = null

    for (let clause of clauses) {
      const negated = clause.match(NEGATION_LEAD)
      if (negated) {
        const rest = clause.slice(negated[0].length)
        const description = describeNegated(rest, index, ctx)
        steps.push({
          action: emptyAction({ actor: ctx.playerEntityId, action: 'unsupported', note: `Understood -- not going to ${description}.` }),
          fuzzy: false,
        })
        continue
      }
      const stopMatch = clause.match(STOP_CANCEL_LEAD)
      if (stopMatch && !/^fighting\b/i.test(stopMatch[1]) && !/^peace/i.test(stopMatch[1])) {
        steps.push({
          action: emptyAction({ actor: ctx.playerEntityId, action: 'unsupported', note: `Understood -- no action taken regarding "${stopMatch[1].trim()}".` }),
          fuzzy: false,
        })
        continue
      }

      const outcome = parseClause(clause, index, ctx)
      if (!outcome) {
        steps.push({
          action: emptyAction({ actor: ctx.playerEntityId, action: 'unsupported', note: `Didn't recognize "${clause}" as a command I know how to execute.` }),
          fuzzy: false,
        })
        continue
      }
      if ('clarification' in outcome) {
        clarificationQuestion = outcome.clarification
        continue
      }
      steps.push({ action: emptyAction({ actor: ctx.playerEntityId, ...outcome.partial }), fuzzy: !!outcome.fuzzy })
    }

    // Apply a trailing self-correction's replacement name to the last
    // resolved step's target, if one is pending.
    if (correctionOverride && steps.length > 0) {
      const last = steps[steps.length - 1]
      const replacement = resolveRegionOrOrganizationOrEntity(correctionOverride.entityText, index)
      if (replacement.ambiguous) {
        clarificationQuestion = ambiguityQuestion(replacement)
      } else if (replacement.id) {
        last.action = { ...last.action, target: replacement.id }
        last.fuzzy = last.fuzzy || replacement.confidence < 1
      }
    }

    if (clarificationQuestion) {
      return {
        ok: false,
        plan: null,
        confidence: 0.3,
        raw: input,
        error: clarificationQuestion,
        clarificationQuestion,
        interpretedSummary: null,
      }
    }

    const whollyUnrecognized = (s: StructuredAction) => s.action === 'unsupported' && s.note?.startsWith('Didn\'t recognize "')
    const meaningfulSteps = steps.filter((s) => !whollyUnrecognized(s.action))

    if (meaningfulSteps.length === 0) {
      return {
        ok: false,
        plan: null,
        confidence: 0,
        raw: input,
        error:
          "Didn't recognize that command. Try things like: \"declare war on Iran\", \"mobilize 100000 troops\", \"increase military spending to 5 percent\", \"sign a treaty with France\", \"build 100 tanks\", \"annex Gaza\".",
        clarificationQuestion: null,
        interpretedSummary: null,
      }
    }

    const plan: StructuredPlan = { steps: steps.map((s) => s.action).slice(0, 8) }
    const anyRecognized = steps.some((s) => s.action.action !== 'unsupported' && s.action.action !== 'unknown')
    const anyFuzzy = steps.some((s) => s.fuzzy)

    let confidence: number
    if (!anyRecognized) confidence = 0.6
    else if (anyFuzzy || anySpellingFixed) confidence = 0.65
    else confidence = 0.92

    return {
      ok: true,
      plan,
      confidence,
      raw: input,
      error: null,
      clarificationQuestion: null,
      interpretedSummary: null,
    }
  }
}

export const fallbackParser = new FallbackParser()
