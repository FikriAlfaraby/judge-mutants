import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

type Label = string | number | boolean

/** How to read a judge's reply as pass or fail. */
export type VerdictRule =
  /**
   * The value at `path` in the reply's JSON must be one of `pass` or one of `fail`; any other value
   * is unreadable. A yes/no rule (`pass: [true]`) fails on the opposite without saying so; a rule
   * with labels ("pass", "A") must list its fail labels.
   */
  | { type: "json"; path: string; pass: readonly Label[]; fail?: readonly Label[] }
  /** A number at `path` counts as pass when it is at least `atLeast`. */
  | { type: "score"; path: string; atLeast: number }
  /** Regular expressions on the raw reply; neither or both matching means the reply is unreadable. */
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

/**
 * Every top-level {...} in a reply that parses as JSON, in order, through code fences and prose.
 * Braces inside JSON strings are skipped; a stray "{" in prose does not hide the JSON after it.
 */
export function jsonObjects(text: string, from = 0): unknown[] {
  const out: unknown[] = []
  let start = -1
  let depth = 0
  let inString = false
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === "\\") i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"' && depth > 0) inString = true
    else if (ch === "{") {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === "}" && depth > 0) {
      depth -= 1
      if (depth === 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          // Braces around prose, not JSON.
        }
      }
    }
  }
  if (depth > 0 && start >= 0) out.push(...jsonObjects(text, start + 1))
  return out
}

/** The first JSON object in a reply, or undefined. */
export function firstJsonObject(text: string): unknown {
  return jsonObjects(text)[0]
}

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), value)
}

/** "(A)", "A.", " PASS " -> "a", "pass": case and the punctuation around a label are not part of it. */
function label(value: Label): Label {
  return typeof value === "string" ? value.toLowerCase().replace(/^[\s"'`*([{]+|[\s"'`*)\]}.,:;!?]+$/g, "") : value
}

function failLabels(rule: { pass: readonly Label[]; fail?: readonly Label[] }): readonly Label[] {
  if (rule.fail) return rule.fail
  return rule.pass.length > 0 && rule.pass.every((p) => typeof p === "boolean") ? rule.pass.map((p) => !p) : []
}

function verdictOf(value: unknown, rule: Exclude<VerdictRule, { type: "regex" }>): Verdict {
  if (rule.type === "score") return typeof value === "number" && Number.isFinite(value) ? (value >= rule.atLeast ? "pass" : "fail") : "unreadable"
  // A value of another type than the rule's labels ("true" where true was asked for) matches
  // neither list, so it is unreadable: the instrument must not guess what the judge meant.
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "unreadable"
  const v = label(value)
  if (rule.pass.some((p) => label(p) === v)) return "pass"
  if (failLabels(rule).some((p) => label(p) === v)) return "fail"
  return "unreadable"
}

/**
 * Read a reply. This parser is strict on purpose: a reply it cannot read is counted as
 * "unreadable", never quietly as pass or fail, so the report can say how often that happened.
 * Every JSON object in the reply that has the path must agree: a reply that quotes an example
 * verdict next to its own is unreadable, not read by whichever object came first.
 */
export function readVerdict(reply: string, rule: VerdictRule): Verdict {
  if (rule.type === "regex") {
    const pass = new RegExp(rule.pass, "i").test(reply)
    const fail = new RegExp(rule.fail, "i").test(reply)
    if (pass === fail) return "unreadable"
    return pass ? "pass" : "fail"
  }
  const verdicts = new Set(
    jsonObjects(reply)
      .map((o) => at(o, rule.path))
      .filter((v) => v !== undefined)
      .map((v) => verdictOf(v, rule)),
  )
  const [only] = verdicts
  return verdicts.size === 1 && only ? only : "unreadable"
}

/** Check a judge file once, before any call, so a typo costs an error message and not a paid run. */
export function validateJudge(input: unknown, where = "judge"): JudgeConfig {
  const problems: string[] = []
  const j = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  for (const key of ["name", "endpoint", "model", "system"]) {
    if (typeof j[key] !== "string" || !(j[key] as string).trim()) problems.push(`${key} must be a non-empty string`)
  }
  if (typeof j.user !== "string") problems.push("user must be a string (it may be empty)")
  if (j.apiKeyEnv !== undefined && typeof j.apiKeyEnv !== "string") problems.push("apiKeyEnv must be a string")
  if (j.temperature !== undefined && !(typeof j.temperature === "number" && Number.isFinite(j.temperature))) problems.push("temperature must be a number")
  if (j.maxTokens !== undefined && !(Number.isInteger(j.maxTokens) && (j.maxTokens as number) > 0)) problems.push("maxTokens must be a positive integer")
  const v = (j.verdict && typeof j.verdict === "object" ? j.verdict : {}) as Record<string, unknown>
  const labels = (x: unknown) => Array.isArray(x) && x.every((l) => ["string", "number", "boolean"].includes(typeof l))
  if (v.type === "regex") {
    for (const key of ["pass", "fail"]) {
      try {
        if (typeof v[key] !== "string") throw new Error("missing")
        new RegExp(v[key] as string, "i")
      } catch (err) {
        problems.push(`verdict.${key} must be a regular expression (${err instanceof Error ? err.message : String(err)})`)
      }
    }
  } else if (v.type === "json") {
    if (typeof v.path !== "string" || !v.path) problems.push("verdict.path must name the field that holds the verdict")
    if (!labels(v.pass) || (v.pass as unknown[]).length === 0) problems.push("verdict.pass must list the values that mean pass")
    if (v.fail !== undefined && !labels(v.fail)) problems.push("verdict.fail must be a list of values")
    if (v.fail === undefined && labels(v.pass) && (v.pass as unknown[]).some((p) => typeof p !== "boolean")) {
      problems.push("verdict.fail must list the values that mean fail, so anything else reads as unreadable")
    }
  } else if (v.type === "score") {
    if (typeof v.path !== "string" || !v.path) problems.push("verdict.path must name the field that holds the score")
    if (typeof v.atLeast !== "number" || !Number.isFinite(v.atLeast)) problems.push("verdict.atLeast must be a number")
  } else {
    problems.push('verdict.type must be "json", "score" or "regex"')
  }
  if (problems.length) throw new Error(`${where}: ${problems.join("; ")}`)
  return j as unknown as JudgeConfig
}

/** A reply that came back broken (empty, cut, an error in a 200): worth asking again, never caching. */
export class IncompleteReply extends Error {}

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`)
    this.status = status
  }
}

export interface Completion {
  text: string
  /** finish_reason of the reply ("stop", "length", ...), or null when the server gave none. */
  finish: string | null
}

interface Choice {
  message?: { content?: string | null }
  delta?: { content?: string | null }
  finish_reason?: string | null
}

/** A chat completion, whether the server answered with JSON or with SSE chunks. */
export function parseCompletion(body: string): Completion {
  const trimmed = body.trim()
  if (/^(data:|:|event:)/.test(trimmed)) return parseStream(trimmed)
  let parsed: { choices?: Choice[]; error?: { message?: string } }
  try {
    parsed = JSON.parse(trimmed) as typeof parsed
  } catch {
    throw new IncompleteReply(`the reply is neither JSON nor a stream: ${trimmed.slice(0, 120)}`)
  }
  if (parsed.error) throw new IncompleteReply(`judge API error: ${parsed.error.message ?? "unknown"}`)
  const choice = parsed.choices?.[0]
  return { text: choice?.message?.content ?? "", finish: choice?.finish_reason ?? null }
}

function parseStream(body: string): Completion {
  let text = ""
  let finish: string | null = null
  let done = false
  for (const line of body.split("\n")) {
    // Comments (": keep-alive"), event names and blank lines carry no content.
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (data === "[DONE]") {
      done = true
      continue
    }
    if (!data) continue
    let chunk: { choices?: Choice[]; error?: { message?: string } }
    try {
      chunk = JSON.parse(data) as typeof chunk
    } catch {
      throw new IncompleteReply("a stream chunk was cut off")
    }
    if (chunk.error) throw new IncompleteReply(`judge API error in the stream: ${chunk.error.message ?? "unknown"}`)
    const choice = chunk.choices?.[0]
    text += choice?.delta?.content ?? choice?.message?.content ?? ""
    finish = choice?.finish_reason ?? finish
  }
  if (!done && finish === null) throw new IncompleteReply("the stream ended before it said it was done")
  return { text, finish }
}

/** The text of a chat completion; throws when the reply is an error or broken. */
export function completionText(body: string): string {
  return parseCompletion(body).text
}

export interface CallOptions {
  /** Directory for cached replies; the same request is never paid for twice. */
  cacheDir: string
  /** Distinguishes repeated calls of the same prompt (repeat 0, 1, 2, ...). */
  repeat: number
  fetchImpl?: typeof fetch
  /** Milliseconds to wait before retry n (default: min(30 s, 2^n s)). */
  backoff?: (attempt: number) => number
}

const ATTEMPTS = 8

function retryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500
  if (err instanceof IncompleteReply) return true
  // fetch rejects with a TypeError when the network fails.
  return err instanceof TypeError
}

async function ask(judge: JudgeConfig, body: object, options: CallOptions): Promise<Completion> {
  const apiKey = judge.apiKeyEnv ? process.env[judge.apiKeyEnv] : undefined
  if (judge.apiKeyEnv && !apiKey) throw new Error(`set ${judge.apiKeyEnv} to the judge's API key`)
  const doFetch = options.fetchImpl ?? fetch
  const wait = options.backoff ?? ((n: number) => Math.min(30_000, 1000 * 2 ** n))
  let lastError: unknown
  // Gateways drop the odd call (a 503 after a stream reset); a long run should ride that out.
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const res = await doFetch(`${judge.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      if (!res.ok) throw new HttpError(res.status, text)
      const completion = parseCompletion(text)
      if (!completion.text.trim()) throw new IncompleteReply("the judge sent an empty reply")
      return completion
    } catch (err) {
      lastError = err
      if (!retryable(err) || attempt === ATTEMPTS - 1) break
      await new Promise((r) => setTimeout(r, wait(attempt)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function readCache(file: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
  try {
    const raw = (JSON.parse(text) as { raw?: unknown }).raw
    return typeof raw === "string" && raw.trim() ? raw : undefined
  } catch {
    return undefined // a file half-written by an older version: ask again
  }
}

/** Write once: the first complete reply for a request wins, and no reader ever sees half a file. */
async function writeCache(file: string, entry: { raw: string } & Record<string, unknown>): Promise<string> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(entry, null, 2))
  try {
    await link(temp, file)
    return entry.raw
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    const winner = await readCache(file)
    if (winner !== undefined) return winner
    await rename(temp, file)
    return entry.raw
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

const inflight = new Map<string, Promise<JudgeCall>>()

/**
 * One judgement. Retries rate limits, server errors and broken replies with backoff, and caches
 * only complete replies. A reply cut off at max tokens counts as unreadable and is not cached, so
 * a rerun with more tokens asks again.
 */
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
  const cached = await readCache(file)
  if (cached !== undefined) return { verdict: readVerdict(cached, judge.verdict), raw: cached, cached: true }

  // Two items with the same prompt in one run are asked once.
  const running = inflight.get(file)
  if (running) return running
  const call = (async (): Promise<JudgeCall> => {
    const completion = await ask(judge, body, options)
    if (completion.finish === "length") return { verdict: "unreadable", raw: completion.text, cached: false }
    const raw = await writeCache(file, { judge: judge.name, model: judge.model, vars, repeat: options.repeat, raw: completion.text })
    return { verdict: readVerdict(raw, judge.verdict), raw, cached: false }
  })()
  inflight.set(file, call)
  try {
    return await call
  } finally {
    inflight.delete(file)
  }
}
