import type { StructuredAction, StructuredPlan, TreatyKind, UnitType } from '@/domain/schemas'
import type { CommandParser, ParseContext } from './types'
import {
  buildResolverIndex,
  resolveEntity,
  resolveOrganization,
  resolveRegionOrOrganizationOrEntity,
  type ResolverIndex,
} from './entityResolver'

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
}

const TREATY_WORDS: [RegExp, TreatyKind][] = [
  [/defen[cs]e (pact|treaty|agreement)/i, 'defense_pact'],
  [/trade (agreement|deal|treaty)/i, 'trade_agreement'],
  [/peace treaty/i, 'peace_treaty'],
  [/non-?aggression/i, 'non_aggression'],
]

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

/** Resolves "this region" / "here" / "this territory" against the player's
 *  current map selection, otherwise defers to the normal name resolver. Used
 *  everywhere a region target is expected, since the player is very likely to
 *  have just clicked the region they're talking about. */
function resolveRegionTarget(text: string, ctx: ParseContext, index: ResolverIndex): string | null {
  if (/^(this region|here|this territory|this area|it)$/i.test(text.trim())) {
    return ctx.selectedRegionId
  }
  const resolved = resolveRegionOrOrganizationOrEntity(text, index)
  return resolved?.id ?? null
}

type Rule = {
  pattern: RegExp
  build: (m: RegExpMatchArray, index: ResolverIndex, ctx: ParseContext) => Partial<StructuredAction> | null
}

const RULES: Rule[] = [
  {
    pattern: /^(?:end|next)\s+turn$/i,
    build: () => ({ action: 'end_turn' }),
  },
  {
    pattern: /^what (?:would happen|if)\b/i,
    build: () => ({
      action: 'unsupported',
      note: 'That is a hypothetical question, not a command -- ask the AI Advisor for analysis, or issue a concrete action instead.',
    }),
  },
  // --- Military ---
  {
    pattern: /(?:declare war on|invade|attack|launch (?:an? )?(?:military )?offensive against|begin military operations against)\s+(.+)/i,
    build: (m, idx) => ({ action: 'declare_war', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /(?:propose|make|seek|negotiate) peace(?: with (.+))?|end (?:the )?war(?: with (.+))?/i,
    build: (m, idx) => ({ action: 'propose_peace', target: m[1] || m[2] ? resolveEntity(m[1] ?? m[2], idx) : null }),
  },
  {
    pattern: /(?:mobilize|call up|raise)\s+([\d,]+)\s*(?:troops|soldiers)?/i,
    build: (m) => ({ action: 'mobilize', quantity: parseNumber(m[1]), unit: 'troops' }),
  },
  {
    pattern: /demobilize\s+([\d,]+)\s*(?:troops|soldiers)?/i,
    build: (m) => ({ action: 'demobilize', quantity: parseNumber(m[1]), unit: 'troops' }),
  },
  {
    pattern: /(?:set|raise|increase|reduce|lower)\s+(?:military\s+)?readiness\s+(?:to\s+)?([\d.]+)\s*(?:percent|%)/i,
    build: (m) => ({ action: 'set_readiness', percent: Number(m[1]) }),
  },
  {
    pattern: /(?:move|reposition|redeploy|deploy|send)\s+(?:[\d,]+\s*(?:troops|soldiers)|them|it|the troops|those troops)?\s*(?:to|toward|towards)\s+(?:the\s+)?(.+?)\s*(?:border|front|frontier)/i,
    build: () => ({
      action: 'unsupported',
      note: 'Troop positioning along specific borders/fronts is not tracked by this simulation. Overall mobilization and readiness are -- try "mobilize" or "set readiness" instead.',
    }),
  },
  {
    pattern: /establish\s+(?:a\s+)?(?:military\s+)?base/i,
    build: () => ({
      action: 'unsupported',
      note: 'Military bases are not modeled as discrete objects in this simulation. Military presence is reflected through mobilization, readiness, and unit counts instead.',
    }),
  },
  {
    pattern: /(increase|raise|hike)\s+military\s+spending\s+by\s+([\d.]+)\s*(?:percent|%)/i,
    build: (m, _idx, ctx) => ({ action: 'set_military_spending', percent: currentEntity(ctx).economy.militarySpendingPctOfGdp + Number(m[2]) }),
  },
  {
    pattern: /(reduce|decrease|lower|cut)\s+military\s+spending\s+by\s+([\d.]+)\s*(?:percent|%)/i,
    build: (m, _idx, ctx) => ({ action: 'set_military_spending', percent: currentEntity(ctx).economy.militarySpendingPctOfGdp - Number(m[2]) }),
  },
  {
    pattern: /(increase|raise|set|reduce|decrease|lower|cut)\s+military\s+spending\s+(?:to\s+)?([\d.]+)\s*(?:percent|%)/i,
    build: (m) => ({ action: 'set_military_spending', percent: Number(m[2]) }),
  },
  {
    pattern: /(?:reduce|decrease|lower|cut)\s+military\s+spending\s*$/i,
    build: (_m, _idx, ctx) => ({ action: 'set_military_spending', percent: Math.max(0, currentEntity(ctx).economy.militarySpendingPctOfGdp - 2) }),
  },
  {
    pattern: /build\s+([\d,]+)\s*(troops?|soldiers?|tanks?|aircraft|planes?|jets?|fighters?|ships?|warships?|artillery|guns?)/i,
    build: (m) => ({
      action: 'build_units',
      quantity: parseNumber(m[1]),
      unit: UNIT_WORDS[m[2].toLowerCase().replace(/s$/, '')] ?? UNIT_WORDS[m[2].toLowerCase()] ?? 'troops',
    }),
  },
  // --- Territory ---
  {
    pattern: /(?:withdraw\s+(?:troops\s+)?from|return|give back|hand back)\s+(.+)/i,
    build: (m, idx, ctx) => {
      const regionId = resolveRegionTarget(m[1], ctx, idx)
      const region = regionId ? ctx.worldState.regions[regionId] : null
      return { action: 'cede_territory', target: regionId, organization: region?.countryId ?? null }
    },
  },
  {
    pattern: /(?:annex|capture|seize)\s+(.+)/i,
    build: (m, idx, ctx) => ({ action: 'annex', target: resolveRegionTarget(m[1], ctx, idx) }),
  },
  {
    pattern: /cede\s+(.+?)\s+to\s+(.+)/i,
    build: (m, idx, ctx) => ({ action: 'cede_territory', target: resolveRegionTarget(m[1], ctx, idx), organization: resolveEntity(m[2], idx) }),
  },
  {
    pattern: /(?:grant independence to|release|liberate)\s+(.+)/i,
    build: (m, idx, ctx) => ({ action: 'grant_independence', target: resolveRegionTarget(m[1], ctx, idx) }),
  },
  // --- Diplomacy ---
  {
    pattern: /sign\s+(?:a\s+)?(.*?)\s*(?:treaty|pact|agreement)?\s*with\s+(.+)/i,
    build: (m, idx) => {
      let treatyType: TreatyKind = 'non_aggression'
      for (const [re, kind] of TREATY_WORDS) {
        if (re.test(m[0])) {
          treatyType = kind
          break
        }
      }
      return { action: 'sign_treaty', target: resolveEntity(m[2], idx), treatyType }
    },
  },
  {
    pattern: /form\s+(?:an\s+)?alliance\s+with\s+(.+)/i,
    build: (m, idx) => ({ action: 'form_alliance', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /break\s+(?:the\s+)?alliance\s+with\s+(.+)/i,
    build: (m, idx) => ({ action: 'break_alliance', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /recognize\s+(.+)/i,
    build: (m, idx) => ({ action: 'recognize', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /withdraw\s+recognition\s+(?:of|from)\s+(.+)/i,
    build: (m, idx) => ({ action: 'withdraw_recognition', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /improve\s+relations\s+with\s+(.+)/i,
    build: (m, idx) => ({ action: 'improve_relations', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /lift\s+sanctions?\s+(?:on\s+)?(.+)/i,
    build: (m, idx) => ({ action: 'lift_sanction', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /(?:impose\s+)?sanctions?\s+(?:on\s+)?(.+)/i,
    build: (m, idx) => ({ action: 'sanction', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /send\s+(?:military\s+)?aid\s+to\s+(.+)/i,
    build: (m, idx) => ({ action: 'send_aid', target: resolveEntity(m[1], idx) }),
  },
  // --- Economy ---
  {
    pattern: /(increase|raise|hike)\s+tax(?:es)?\s+by\s+([\d.]+)\s*(?:percent|%)/i,
    build: (m, _idx, ctx) => ({ action: 'set_tax_rate', percent: currentEntity(ctx).economy.taxRatePct + Number(m[2]) }),
  },
  {
    pattern: /(reduce|decrease|lower|cut)\s+tax(?:es)?\s+by\s+([\d.]+)\s*(?:percent|%)/i,
    build: (m, _idx, ctx) => ({ action: 'set_tax_rate', percent: currentEntity(ctx).economy.taxRatePct - Number(m[2]) }),
  },
  {
    pattern: /(?:set|increase|raise|reduce|decrease|lower)\s+tax(?:es)?\s+(?:rate\s+)?(?:to\s+)?([\d.]+)\s*(?:percent|%)/i,
    build: (m) => ({ action: 'set_tax_rate', percent: Number(m[1]) }),
  },
  // --- Research ---
  {
    pattern: /(?:start\s+)?research(?:ing)?\s+(.+)/i,
    build: (m) => ({ action: 'research_tech', note: m[1].trim() }),
  },
  // --- Politics / organizations ---
  {
    pattern: /^(?:dissolve|disband)\s+(.+)/i,
    build: (m, idx) => ({ action: 'dissolve_organization', organization: resolveOrganization(m[1], idx) }),
  },
  {
    pattern: /(?:call|hold)\s+(?:a\s+)?(?:snap\s+)?election/i,
    build: () => ({ action: 'call_election' }),
  },
]

/** Splits a compound command like "mobilize 200,000 troops, move them to the
 *  northern border, increase military spending to 6%, and sign a defense
 *  agreement with France" into independently-parseable clauses. Splits only
 *  immediately before a recognized action verb, so ordinary lists inside a
 *  single clause (e.g. "sanction Russia and Belarus") are left intact. */
const LEAD_VERBS =
  'declare|invade|attack|launch|begin|propose|make|seek|negotiate|end the war|mobilize|call up|demobilize|build|annex|capture|seize|withdraw|return|give back|hand back|cede|grant|release|liberate|sign|form|break|recognize|improve relations|lift sanctions|sanction|impose sanctions|send|set|increase|raise|hike|reduce|decrease|lower|cut|establish|move|reposition|redeploy|deploy|research|dissolve|disband|call an election|hold an election|call a snap election'
// Splits on "X, and Y" / "X and Y" / "X then Y" (a connector word present), and
// also on a bare "X, Y" oxford-list comma when Y opens with a recognized verb
// (covers "mobilize troops, raise spending, and sign a treaty" where only the
// last item has an explicit "and"). A semicolon always splits.
const CLAUSE_SPLIT = new RegExp(
  `\\s*(?:,\\s*)?(?:and then|and|then)\\s+(?=(?:${LEAD_VERBS})\\b)` +
    `|,\\s+(?=(?:${LEAD_VERBS})\\b)` +
    `|;\\s*(?=\\S)`,
  'gi',
)

function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
}

function currentEntity(ctx: ParseContext) {
  return ctx.worldState.entities[ctx.playerEntityId]
}

function parseClause(text: string, index: ResolverIndex, ctx: ParseContext): StructuredAction | null {
  for (const rule of RULES) {
    const match = text.match(rule.pattern)
    if (!match) continue
    const partial = rule.build(match, index, ctx)
    if (!partial) continue
    return emptyAction({ actor: ctx.playerEntityId, ...partial })
  }
  return null
}

export class FallbackParser implements CommandParser {
  readonly id = 'fallback' as const

  isAvailable(): boolean {
    return true
  }

  async parse(input: string, ctx: ParseContext): Promise<import('@/domain/schemas').ParseResult> {
    const index = buildResolverIndex(ctx.worldState)
    const clauses = splitClauses(input)
    const steps: StructuredAction[] = []

    for (const clause of clauses) {
      const action = parseClause(clause, index, ctx)
      if (action) {
        steps.push(action)
      } else {
        steps.push(
          emptyAction({
            actor: ctx.playerEntityId,
            action: 'unsupported',
            note: `Didn't recognize "${clause}" as a command I know how to execute.`,
          }),
        )
      }
    }

    if (steps.length === 0) {
      return {
        ok: false,
        plan: null,
        confidence: 0,
        raw: input,
        error:
          "Didn't recognize that command. Try things like: \"declare war on Iran\", \"mobilize 100000 troops\", \"increase military spending to 5 percent\", \"sign a treaty with France\", \"build 100 tanks\", \"annex Gaza\".",
      }
    }

    // A clause is "wholly unrecognized" only when no rule matched it at all --
    // that's different from a clause a rule DID match but which names a
    // feature this simulation doesn't model (e.g. "establish a military
    // base"). The latter is still worth sending to the validator so the
    // player gets the specific, honest explanation instead of a generic
    // "didn't understand" message.
    const whollyUnrecognized = (s: StructuredAction) => s.action === 'unsupported' && s.note?.startsWith('Didn\'t recognize "')
    const meaningfulSteps = steps.filter((s) => !whollyUnrecognized(s))
    const plan: StructuredPlan = { steps: steps.slice(0, 8) }

    if (meaningfulSteps.length === 0) {
      return {
        ok: false,
        plan: null,
        confidence: 0,
        raw: input,
        error:
          "Didn't recognize that command. Try things like: \"declare war on Iran\", \"mobilize 100000 troops\", \"increase military spending to 5 percent\", \"sign a treaty with France\", \"build 100 tanks\", \"annex Gaza\".",
      }
    }

    const anyRecognized = steps.some((s) => s.action !== 'unsupported' && s.action !== 'unknown')
    return {
      ok: true,
      plan,
      confidence: anyRecognized ? 0.9 : 0.6,
      raw: input,
      error: null,
    }
  }
}

export const fallbackParser = new FallbackParser()
