/**
 * Optional cloud-AI fallback, per the project's explicit requirement that
 * this NEVER be mandatory and NEVER silently send game data anywhere. It is
 * unconfigured by default in this deployment -- getCloudAiConfig() returns
 * null unless a deployer sets build-time env vars, so normal players never
 * touch a paid external API; the advisor falls back to the deterministic
 * basic advisor (src/ai/advisorFallback.ts) instead.
 *
 * To enable (deployer opt-in only): set VITE_CLOUD_AI_ENDPOINT and
 * VITE_CLOUD_AI_KEY (and optionally VITE_CLOUD_AI_PROVIDER) at build time.
 * The endpoint is expected to be OpenAI-chat-completions-compatible.
 */
export interface CloudAiConfig {
  provider: string
  endpoint: string
  apiKey: string
}

export function getCloudAiConfig(): CloudAiConfig | null {
  const endpoint = import.meta.env.VITE_CLOUD_AI_ENDPOINT as string | undefined
  const apiKey = import.meta.env.VITE_CLOUD_AI_KEY as string | undefined
  if (!endpoint || !apiKey) return null
  return {
    provider: (import.meta.env.VITE_CLOUD_AI_PROVIDER as string | undefined) ?? 'custom',
    endpoint,
    apiKey,
  }
}

export async function callCloudAi(
  config: CloudAiConfig,
  messages: { role: string; content: string }[],
): Promise<string> {
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ messages, temperature: 0.6, max_tokens: 400 }),
  })
  if (!res.ok) throw new Error(`Cloud AI request failed: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}
