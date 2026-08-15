import type { WorldEntity } from '@/domain/schemas'

export interface Narrative {
  background: string
  trigger: string
  situation: string
  internationalReaction: string
  consequences: string
}

function relationshipTone(opinion: number | null): 'unknown' | 'bitter' | 'cool' | 'stable' {
  if (opinion === null) return 'unknown'
  if (opinion < -60) return 'bitter'
  if (opinion < -20) return 'cool'
  return 'stable'
}

export function buildWarNarrative(actor: WorldEntity, target: WorldEntity, opinion: number | null): Narrative {
  const tone = relationshipTone(opinion)
  const background =
    tone === 'unknown'
      ? `${actor.name} and ${target.name} had no significant recorded relationship before this declaration.`
      : tone === 'bitter'
        ? `Relations between ${actor.name} and ${target.name} have been deteriorating for months, marked by repeated diplomatic friction, mutual distrust, and a string of unresolved border incidents.`
        : tone === 'cool'
          ? `${actor.name} and ${target.name} have maintained an uneasy, cooling relationship in the period leading up to this declaration.`
          : `${actor.name} and ${target.name} had maintained comparatively stable relations until this sudden declaration.`
  return {
    background,
    trigger: `${actor.name}'s government cited the deteriorating security situation and unresolved grievances with ${target.name} as justification for military action.`,
    situation: `${actor.name}: At war\n${target.name}: At war\nConflict: ${actor.name}-${target.name} War\nSeverity: Major\nStatus: Active`,
    internationalReaction: `Neighboring governments have called for restraint as the international community assesses the risk of a wider regional crisis.`,
    consequences: `Military spending, mobilization, and border security are expected to rise on both sides. Trade and regional stability may suffer the longer the fighting continues, and allied countries could be drawn into the conflict.`,
  }
}

export function buildCivilWarNarrative(country: WorldEntity, rebel: WorldEntity, rebelRegionShare: number): Narrative {
  const sharePct = Math.round(rebelRegionShare * 100)
  return {
    background: `Government stability in ${country.name} had collapsed under the weight of unrest and eroding public confidence, leaving state authority fragile across large parts of the country.`,
    trigger: `${rebel.name} emerged from this vacuum, seizing territory and declaring a provisional government in opposition to ${country.name}'s ruling authorities.`,
    situation: `${country.name} (government): controls the remaining territory\n${rebel.name} (rebels): controls roughly ${sharePct}% of the country's regions\nStatus: Active civil conflict`,
    internationalReaction: `Foreign governments are monitoring the situation for humanitarian impact and the risk of spillover into neighboring states.`,
    consequences: `Refugee movement, disrupted infrastructure, and further economic decline are likely in the contested regions as the government and rebel forces fight for control.`,
  }
}

export function buildEconomicCrisisNarrative(entity: WorldEntity): Narrative {
  const econ = entity.economy
  return {
    background: `${entity.name}'s economy had been showing signs of strain, with unemployment at ${econ.unemploymentRatePct.toFixed(1)}% and public debt at ${econ.debtToGdpPct.toFixed(0)}% of GDP heading into this downturn.`,
    trigger: `Economic output contracted for a second consecutive quarter, tipping the country into recession.`,
    situation: `GDP growth: ${econ.growthRatePct.toFixed(1)}%\nUnemployment: ${econ.unemploymentRatePct.toFixed(1)}%\nInflation: ${econ.inflationPct.toFixed(1)}%\nStatus: Recession`,
    internationalReaction: `Trading partners and credit markets are watching closely for signs of contagion to the wider region.`,
    consequences: `Rising unemployment and falling government revenue may increase public unrest and pressure the government to adjust fiscal and monetary policy.`,
  }
}

export function buildCoupNarrative(entity: WorldEntity): Narrative {
  return {
    background: `Governing authority in ${entity.name} had been steadily weakening amid low public confidence and persistent instability.`,
    trigger: `The armed forces moved to seize control of the government, citing the country's collapsing stability.`,
    situation: `New government: military junta\nCapital and key institutions: under military control\nStatus: Power consolidation underway`,
    internationalReaction: `Foreign governments are withholding recognition pending clarity on the new leadership's intentions, and some may consider sanctions.`,
    consequences: `A period of political uncertainty is likely, with elevated risk of further unrest, international isolation, or a counter-coup if the new government fails to stabilize the country.`,
  }
}

export function buildElectionNarrative(entity: WorldEntity, winnerPartyName: string): Narrative {
  return {
    background: `${entity.name} held a scheduled general election after the previous government's term of office concluded.`,
    trigger: `Voters delivered a shift in support toward ${winnerPartyName}, unseating the previous ruling party.`,
    situation: `Winning party: ${winnerPartyName}\nGovernment stability: ${entity.government.stability.toFixed(0)}\nStatus: New government formed`,
    internationalReaction: `Foreign partners have offered customary congratulations and expressed interest in continuity of existing agreements.`,
    consequences: `The incoming government is expected to set new domestic and foreign policy priorities in the coming turns.`,
  }
}

export function buildDiplomaticCrisisNarrative(a: WorldEntity, b: WorldEntity, opinion: number): Narrative {
  return {
    background: `${a.name} and ${b.name} share a border in ${'subregion' in a ? a.subregion : 'the region'}, and relations between the two have been cooling for some time.`,
    trigger: `A series of incidents along their shared frontier has pushed relations to a new low, with both governments issuing public warnings.`,
    situation: `${a.name}-${b.name} relations: ${opinion.toFixed(0)} (deteriorating)\nStatus: Rising tension, no formal state of war`,
    internationalReaction: `Regional bodies have urged both governments to exercise restraint and pursue dialogue before the situation escalates further.`,
    consequences: `Continued deterioration could lead to military mobilization, border skirmishes, or an outright declaration of war if tensions are not defused.`,
  }
}
