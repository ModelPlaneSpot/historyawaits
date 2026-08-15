/** Questions must never be executed as commands (spec: "Should we invade
 *  Iran?" is a question; "Invade Iran." is a command). A trailing "?" is a
 *  reliable signal on its own; the leading-phrase list catches questions
 *  players often don't bother punctuating. */
const QUESTION_LEAD =
  /^(?:should|could|would|can|shall)\s+we\b|^do you think\b|^is it\s+(?:a good idea|possible|wise|worth it)\b|^what\s+(?:would|might|could)\s+happen\b|^what\s+if\b|^what\s+happens\s+if\b|^why\s+(?:should|would|do|don'?t)\s+we\b|^how about\b|^i wonder\s+if\b/i

export function isQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.endsWith('?')) return true
  return QUESTION_LEAD.test(trimmed)
}
