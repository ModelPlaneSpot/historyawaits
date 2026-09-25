import type { WorldState } from '@/domain/schemas'
import { localAiEngine } from './localAiEngine'
import { buildAdvisorContext } from './advisorContext'
import { factCheckReply } from './factCheck'
import { basicAdvisorReply, NO_CANNED_ANSWER } from './advisorFallback'

export type AdvisorSource = 'local-ai' | 'fallback'

export interface AdvisorMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  turn: number
  source?: AdvisorSource
}

const MAX_RAW_MESSAGES = 16 // keep the most recent ~8 exchanges verbatim
const SUMMARIZE_DOWN_TO = 8

const SYSTEM_PROMPT_HEADER = `You are the player's government advisor in a geopolitical strategy game. You speak plainly and strategically, like a senior cabinet advisor briefing a head of state. You have access to the CURRENT, LIVE state of their country and the world below, fetched fresh for this exact message -- use these ACTUAL numbers, never invent figures, and never reuse a figure from earlier in this conversation if it conflicts with what's given below (the simulation has likely moved on since then; what's below is always correct as of right now).

You are READ-ONLY: you cannot declare war, move troops, change borders, spend money, or take any other action. If the player should do something, tell them what to type as a command (e.g. "you could type: mobilize 100000 troops") -- you do not execute it yourself.

For hypothetical ("what if...") questions, analyze the likely consequences using the real numbers provided, but make clear nothing has actually happened -- you are only forecasting.

For other countries' military strength, speak the way an intelligence briefing would -- "our estimates suggest," "approximately" -- since those figures are estimates, not our own exact knowledge. For our own country's figures, they are exact.

If asked about something not tracked below (e.g. a specific unit type, submarines, nuclear weapons, city-level detail), say plainly that it isn't tracked by this simulation rather than inventing a number.

Never guarantee an outcome of a hypothetical war or event -- use appropriate uncertainty ("likely," "would probably," "risks").

Keep replies focused and conversational -- a few sentences to a short paragraph, not an essay, unless the player explicitly asks for a detailed breakdown or multiple strategies.

Current world state (live, as of this message):
`

let idCounter = 0
function nextId() {
  idCounter += 1
  return `advisor-${Date.now()}-${idCounter}`
}

export interface AdvisorState {
  messages: AdvisorMessage[]
  summary: string | null
}

export function emptyAdvisorState(): AdvisorState {
  return { messages: [], summary: null }
}

/** Which source will actually answer the next message -- surfaced in the UI
 *  so the player knows what's powering the advisor right now. */
export function currentAdvisorSource(): AdvisorSource {
  if (localAiEngine.isReady()) return 'local-ai'
  return 'fallback'
}

/** Sends one player message, returns the assistant's reply and the updated
 *  (possibly summarized) conversation state. Never touches world state --
 *  only reads it, fresh, to build context for this one message. Falls back
 *  to a deterministic no-model answer when no AI backend is available. */
export async function sendAdvisorMessage(
  worldState: WorldState,
  advisorState: AdvisorState,
  userText: string,
): Promise<{ reply: string; state: AdvisorState }> {
  const source = currentAdvisorSource()

  let reply: string
  if (source === 'fallback') {
    reply = basicAdvisorReply(worldState, userText) ?? NO_CANNED_ANSWER
  } else {
    const context = buildAdvisorContext(worldState, userText)
    const systemContent = SYSTEM_PROMPT_HEADER + context + (advisorState.summary ? `\n\n=== Earlier conversation summary ===\n${advisorState.summary}` : '')
    const history: { role: 'user' | 'assistant'; content: string }[] = advisorState.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemContent },
      ...history,
      { role: 'user', content: userText },
    ]

    const engine = localAiEngine.getEngine()
    if (!engine) throw new Error('Local AI model is not loaded.')
    const completion = await engine.chat.completions.create({ messages, temperature: 0.6, max_tokens: 400 })
    reply = completion.choices[0]?.message?.content?.trim() || "I'm not sure how to answer that -- could you rephrase?"
    // The simulation, never the model, is authoritative for game statistics --
    // catch and correct any figure the model got wrong or repeated from stale context.
    reply = factCheckReply(reply, worldState)
  }

  const turn = worldState.turn
  const nextMessages: AdvisorMessage[] = [
    ...advisorState.messages,
    { id: nextId(), role: 'user', content: userText, turn },
    { id: nextId(), role: 'assistant', content: reply, turn, source },
  ]

  const summarized = await maybeSummarize(nextMessages, advisorState.summary)
  return { reply, state: summarized }
}

/** Once the raw history grows past MAX_RAW_MESSAGES, collapse the oldest
 *  messages into a running summary via one extra local-model call, keeping
 *  the most recent exchanges verbatim. Bounds memory without ever calling
 *  an external/paid API. */
async function maybeSummarize(messages: AdvisorMessage[], priorSummary: string | null): Promise<AdvisorState> {
  if (messages.length <= MAX_RAW_MESSAGES) {
    return { messages, summary: priorSummary }
  }
  const cutoff = messages.length - SUMMARIZE_DOWN_TO
  const toSummarize = messages.slice(0, cutoff)
  const keep = messages.slice(cutoff)

  const engine = localAiEngine.getEngine()
  if (!engine) {
    // Can't summarize without the model -- just hard-truncate rather than block.
    return { messages: keep, summary: priorSummary }
  }
  try {
    const transcript = toSummarize.map((m) => `${m.role === 'user' ? 'Player' : 'Advisor'}: ${m.content}`).join('\n')
    const completion = await engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'Summarize this advisor conversation in 2-4 sentences, preserving any strategic decisions, concerns, or context the player will expect the advisor to still remember. Be concise.',
        },
        { role: 'user', content: `${priorSummary ? `Earlier summary: ${priorSummary}\n\n` : ''}${transcript}` },
      ],
      temperature: 0.3,
      max_tokens: 200,
    })
    const newSummary = completion.choices[0]?.message?.content?.trim() || priorSummary
    return { messages: keep, summary: newSummary }
  } catch (err) {
    console.error('Advisor history summarization failed', err)
    return { messages: keep, summary: priorSummary }
  }
}
