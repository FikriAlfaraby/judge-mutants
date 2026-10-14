import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** How to read a judge's reply as pass or fail. */
export type VerdictRule =
  /** Find the first JSON object in the reply; the value at `path` must be one of `pass`. */
  | { type: "json"; path: string; pass: readonly (string | number | boolean)[] }
  /** A number at `path` counts as pass when it is at least `atLeast`. */
  | { type: "score"; path: string; atLeast: number }
  /** Regular expressions on the raw reply; neither matching means the reply is unreadable. */
  | { type: "regex"; pass: string; fail: string }

/** A judge is a model plus a prompt plus a way to read its verdict. */
export interface JudgeConfig {
  name: string
  /** OpenAI-compatible base URL, e.g. http://127.0.0.1:20128/v1 */
  endpoint: string
  model: string
  /** Name of the environment variable that holds the API key; the key itself never sits in config. */
  apiKeyEnv?: string
  temperature?: number
  maxTokens?: number
  extraBody?: Record<string, unknown>
  system: string
  /** User message with {{name}} slots; {{answer}} is the answer under judgement. May be empty when the
   * whole prompt lives in the system message (OpenAI's closed-QA prompt does that). */
  user: string
  verdict: VerdictRule
}

export type Verdict = "pass" | "fail" | "unreadable"

export interface JudgeCall {
  verdict: Verdict
  raw: string
  cached: boolean
}

/** Fill {{name}} slots. A slot with no value is an error: a silently empty prompt grades nothing. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const value = vars[name]
    if (value === undefined) throw new Error(`template slot {{${name}}} has no value`)
    return value
  })
}

/** The first balanced {...} in a reply, ignoring code fences and text around it. */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{")
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === "\\") i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), value)
}

/**
 * Read a reply. This parser is strict on purpose: a reply it cannot read is counted as
 * "unreadable", never quietly as pass or fail, so the report can say how often that happened.
 */
export function readVerdict(reply: string, rule: VerdictRule): Verdict {
  if (rule.type === "regex") {
    if (new RegExp(rule.pass, "i").test(reply)) return "pass"
    if (new RegExp(rule.fail, "i").test(reply)) return "fail"
    return "unreadable"
  }
  const value = at(firstJsonObject(reply), rule.path)
  if (rule.type === "score") return typeof value === "number" ? (value >= rule.atLeast ? "pass" : "fail") : "unreadable"
  if (value === undefined || value === null) return "unreadable"
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "unreadable"
  // A value of another type than the rule expects ("true" where true was asked for) is unreadable,
  // not a verdict: the instrument must not guess what the judge meant.
  if (rule.pass.length > 0 && rule.pass.every((p) => typeof p !== typeof value)) return "unreadable"
  return rule.pass.includes(typeof value === "string" ? value.toLowerCase() : value) ? "pass" : "fail"
}

/** The text of a chat completion, whether the server answered with JSON or with SSE chunks. */
export function completionText(body: string): string {
  const trimmed = body.trim()
  if (trimmed.startsWith("data:")) {
    let text = ""
    for (const line of trimmed.split("\n")) {
      const data = line.replace(/^data:\s*/, "").trim()
      if (!data || data === "[DONE]" || !line.startsWith("data:")) continue
      try {
        const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] }
        text += chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? ""
      } catch {
        // A partial chunk; the rest of the stream still counts.
      }
    }
    return text
  }
  const parsed = JSON.parse(trimmed) as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } }
  if (parsed.error) throw new Error(`judge API error: ${parsed.error.message ?? "unknown"}`)
  return parsed.choices?.[0]?.message?.content ?? ""
}

export interface CallOptions {
  /** Directory for cached replies; the same request is never paid for twice. */
  cacheDir: string
  /** Distinguishes repeated calls of the same prompt (repeat 0, 1, 2, ...). */
  repeat: number
  fetchImpl?: typeof fetch
}

/** One judgement. Retries rate limits and server errors with backoff; caches every reply. */
export async function callJudge(judge: JudgeConfig, vars: Record<string, string>, options: CallOptions): Promise<JudgeCall> {
  const body = {
    model: judge.model,
    temperature: judge.temperature ?? 0,
    max_tokens: judge.maxTokens ?? 400,
    stream: false,
    messages: [
      { role: "system", content: render(judge.system, vars) },
      ...(judge.user ? [{ role: "user", content: render(judge.user, vars) }] : []),
    ],
    ...judge.extraBody,
  }
  const key = createHash("sha256").update(JSON.stringify({ endpoint: judge.endpoint, body, repeat: options.repeat })).digest("hex")
  const file = join(options.cacheDir, `${key}.json`)
  try {
    const raw = (JSON.parse(await readFile(file, "utf8")) as { raw: string }).raw
    return { verdict: readVerdict(raw, judge.verdict), raw, cached: true }
  } catch {
    // Not cached yet.
  }

  const apiKey = judge.apiKeyEnv ? process.env[judge.apiKeyEnv] : undefined
  if (judge.apiKeyEnv && !apiKey) throw new Error(`set ${judge.apiKeyEnv} to the judge's API key`)
  const doFetch = options.fetchImpl ?? fetch
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await doFetch(`${judge.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
      const raw = completionText(text)
      await mkdir(options.cacheDir, { recursive: true })
      await writeFile(file, JSON.stringify({ judge: judge.name, model: judge.model, vars, repeat: options.repeat, raw }, null, 2))
      return { verdict: readVerdict(raw, judge.verdict), raw, cached: false }
    } catch (err) {
      lastError = err
      if (err instanceof Error && /HTTP 4(0[0-9]|1[0-9])/.test(err.message) && !/HTTP 429/.test(err.message)) break
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
