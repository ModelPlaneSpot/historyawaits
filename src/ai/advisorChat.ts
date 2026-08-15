import type { WorldState } from '@/domain/schemas'
import { localAiEngine } from './localAiEngine'
import { buildAdvisorContext } from './advisorContext'

export interface AdvisorMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  turn: number
}

const MAX_RAW_MESSAGES = 16 // keep the most recent ~8 exchanges verbatim
const SUMMARIZE_DOWN_TO = 8

const SYSTEM_PROMPT_HEADER = `You are the player's government advisor in a geopolitical strategy game. You speak plainly and strategically, like a senior cabinet advisor briefing a head of state. You have access to the current state of their country and the world below -- use the ACTUAL numbers given, never invent figures.

You are READ-ONLY: you cannot declare war, move troops, change borders, spend money, or take any other action. If the player should do something, tell them what to type as a command (e.g. "you could type: mobilize 100000 troops") -- you do not execute it yourself.

For hypothetical ("what if...") questions, analyze the likely consequences using the real numbers provided, but make clear nothing has actually happened -- you are only forecasting.

For other countries' military strength, speak the way an intelligence briefing would -- "our estimates suggest," "approximately" -- since those figures are estimates, not our own exact knowledge. For our own country's figures, they are exact.

Never guarantee an outcome of a hypothetical war or event -- use appropriate uncertainty ("likely," "would probably," "risks").

Keep replies focused and conversational -- a few sentences to a short paragraph, not an essay, unless the player explicitly asks for a detailed breakdown or multiple strategies.

Current world state:
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

/** Sends one player message, returns the assistant's reply and the updated
 *  (possibly summarized) conversation state. Never touches world state --
 *  only reads it to build context for the prompt. */
export async function sendAdvisorMessage(
  worldState: WorldState,
  advisorState: AdvisorState,
  userText: string,
): Promise<{ reply: string; state: AdvisorState }> {
  const engine = localAiEngine.getEngine()
  if (!engine) {
    throw new Error('Local AI model is not loaded.')
  }

  const context = buildAdvisorContext(worldState)
  const systemContent = SYSTEM_PROMPT_HEADER + context + (advisorState.summary ? `\n\n=== Earlier conversation summary ===\n${advisorState.summary}` : '')

  const history = advisorState.messages.map((m) => ({ role: m.role, content: m.content }))

  const completion = await engine.chat.completions.create({
    messages: [{ role: 'system', content: systemContent }, ...history, { role: 'user', content: userText }],
    temperature: 0.6,
    max_tokens: 400,
  })
  const reply = completion.choices[0]?.message?.content?.trim() || "I'm not sure how to answer that -- could you rephrase?"

  const turn = worldState.turn
  const nextMessages: AdvisorMessage[] = [
    ...advisorState.messages,
    { id: nextId(), role: 'user', content: userText, turn },
    { id: nextId(), role: 'assistant', content: reply, turn },
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
