import type { StructuredAction, ActionType, TreatyKind, UnitType } from '@/domain/schemas'
import type { CommandParser, ParseContext } from './types'
import {
  buildResolverIndex,
  resolveEntity,
  resolveOrganization,
  resolveRegionOrOrganizationOrEntity,
} from './entityResolver'

function emptyAction(overrides: Partial<StructuredAction>): StructuredAction {
  return {
    actor: '',
    action: 'unknown',
    target: null,
    secondaryAction: null,
    organization: null,
    treatyType: null,
    quantity: null,
    unit: null,
    percent: null,
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

/** Splits an "X and dissolve/disband Y" style compound command into its
 *  primary clause and a secondary dissolve_organization action. */
function extractSecondaryDissolve(
  text: string,
  index: ReturnType<typeof buildResolverIndex>,
): { primaryText: string; secondaryAction: ActionType | null; organization: string | null } {
  const match = text.match(/\band\s+(?:dissolve|disband)\s+([a-z0-9 '-]+)/i)
  if (!match) return { primaryText: text, secondaryAction: null, organization: null }
  const orgId = resolveOrganization(match[1], index)
  const primaryText = text.slice(0, match.index).trim()
  return { primaryText, secondaryAction: 'dissolve_organization', organization: orgId }
}

type Rule = {
  pattern: RegExp
  build: (m: RegExpMatchArray, index: ReturnType<typeof buildResolverIndex>) => Partial<StructuredAction> | null
}

const RULES: Rule[] = [
  {
    pattern: /^(?:end|next)\s+turn$/i,
    build: () => ({ action: 'end_turn' }),
  },
  {
    pattern: /declare war on (.+)/i,
    build: (m, idx) => ({ action: 'declare_war', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /(?:propose|make|seek) peace(?: with (.+))?/i,
    build: (m, idx) => ({ action: 'propose_peace', target: m[1] ? resolveEntity(m[1], idx) : null }),
  },
  {
    pattern: /mobilize\s+([\d,]+)\s*(troops|soldiers)?/i,
    build: (m) => ({ action: 'mobilize', quantity: parseNumber(m[1]), unit: 'troops' }),
  },
  {
    pattern: /(increase|raise|set|reduce|decrease|lower)\s+military\s+spending\s+(?:to\s+)?([\d.]+)\s*(?:percent|%)/i,
    build: (m) => ({ action: 'set_military_spending', percent: Number(m[2]) }),
  },
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
    pattern: /lift\s+sanctions?\s+(?:on\s+)?(.+)/i,
    build: (m, idx) => ({ action: 'lift_sanction', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /(?:impose\s+)?sanctions?\s+(?:on\s+)?(.+)/i,
    build: (m, idx) => ({ action: 'sanction', target: resolveEntity(m[1], idx) }),
  },
  {
    pattern: /build\s+([\d,]+)\s*(troops?|tanks?|aircraft|planes?|jets?|ships?|warships?|artillery|guns?)/i,
    build: (m) => ({
      action: 'build_units',
      quantity: parseNumber(m[1]),
      unit: UNIT_WORDS[m[2].toLowerCase().replace(/s$/, '')] ?? UNIT_WORDS[m[2].toLowerCase()] ?? 'troops',
    }),
  },
  {
    pattern: /^(?:dissolve|disband)\s+(.+)/i,
    build: (m, idx) => ({ action: 'dissolve_organization', organization: resolveOrganization(m[1], idx) }),
  },
  {
    pattern: /annex\s+(.+)/i,
    build: (m, idx) => {
      const resolved = resolveRegionOrOrganizationOrEntity(m[1], idx)
      return { action: 'annex', target: resolved?.id ?? null }
    },
  },
]

export class FallbackParser implements CommandParser {
  readonly id = 'fallback' as const

  isAvailable(): boolean {
    return true
  }

  async parse(input: string, ctx: ParseContext): Promise<import('@/domain/schemas').ParseResult> {
    const index = buildResolverIndex(ctx.worldState)
    const { primaryText, secondaryAction, organization } = extractSecondaryDissolve(input, index)

    for (const rule of RULES) {
      const match = primaryText.match(rule.pattern)
      if (!match) continue
      const partial = rule.build(match, index)
      if (!partial) continue
      const action = emptyAction({
        actor: ctx.playerEntityId,
        secondaryAction,
        organization,
        ...partial,
      })
      return {
        ok: true,
        action,
        confidence: 0.9,
        raw: input,
        error: null,
      }
    }

    return {
      ok: false,
      action: null,
      confidence: 0,
      raw: input,
      error:
        "Didn't recognize that command. Try things like: \"declare war on Iran\", \"mobilize 100000 troops\", \"increase military spending to 5 percent\", \"sign a treaty with France\", \"build 100 tanks\", \"annex Gaza\".",
    }
  }
}

export const fallbackParser = new FallbackParser()
