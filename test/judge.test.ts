import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { callJudge, completionText, firstJsonObject, readVerdict, render, validateJudge } from "../src/judge.ts"
import type { JudgeConfig } from "../src/judge.ts"

test("templates fill every slot and refuse a missing one", () => {
  assert.equal(render("Q: {{question}} A: {{ answer }}", { question: "2+2", answer: "4" }), "Q: 2+2 A: 4")
  assert.throws(() => render("{{reference}}", {}), /reference/)
})

test("the first JSON object is found through fences and text, braces in strings included", () => {
  assert.deepEqual(firstJsonObject('Sure!\n```json\n{"pass": false, "reason": "uses {x}"}\n```'), { pass: false, reason: "uses {x}" })
  assert.equal(firstJsonObject("no json here"), undefined)
  assert.equal(firstJsonObject('{"pass": tru'), undefined)
})

test("verdicts: strict reading, unreadable instead of a guess", () => {
  const rule = { type: "json", path: "pass", pass: [true] } as const
  assert.equal(readVerdict('{"pass": true}', rule), "pass")
  assert.equal(readVerdict('{"pass": false}', rule), "fail")
  assert.equal(readVerdict('{"pass": "true"}', rule), "unreadable", "a string where a boolean was asked for")
  assert.equal(readVerdict('{"verdict": true}', rule), "unreadable")
  assert.equal(readVerdict("PASS", rule), "unreadable")
  const nested = { type: "json", path: "grounded.verdict", pass: ["pass"], fail: ["fail"] } as const
  assert.equal(readVerdict('{"grounded": {"score": 5, "verdict": "PASS"}}', nested), "pass")
  assert.equal(readVerdict('{"grounded": {"score": 5, "verdict": "fail"}}', nested), "fail")
  assert.equal(readVerdict('{"grounded": {"score": 5, "verdict": "passed"}}', nested), "unreadable", "a label on neither list")
  assert.equal(readVerdict('{"score": 4}', { type: "score", path: "score", atLeast: 4 }), "pass")
  assert.equal(readVerdict('{"score": "4"}', { type: "score", path: "score", atLeast: 4 }), "unreadable")
  assert.equal(readVerdict("Verdict: FAIL", { type: "regex", pass: "verdict:\\s*pass", fail: "verdict:\\s*fail" }), "fail")
})

test("replies come as plain JSON or as SSE chunks", () => {
  assert.equal(completionText('{"choices":[{"message":{"content":"{\\"pass\\": true}"}}]}'), '{"pass": true}')
  const sse = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    'data: {"choices":[{"delta":{"content":"{\\"pass\\": "}}]}',
    'data: {"choices":[{"delta":{"content":"false}"}}]}',
    "data: [DONE]",
  ].join("\n\n")
  assert.equal(completionText(sse), '{"pass": false}')
  assert.throws(() => completionText('{"error":{"message":"Missing API key"}}'), /Missing API key/)
})

const JUDGE: JudgeConfig = {
  name: "stub",
  endpoint: "http://stub.invalid/v1",
  model: "stub-model",
  system: "grade",
  user: "{{reference}} | {{answer}}",
  verdict: { type: "json", path: "pass", pass: [true] },
}

test("a call retries a rate limit, then caches the reply", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "jm-cache-"))
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    if (calls === 1) return new Response("slow down", { status: 429 })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"pass": true}' } }] }))
  }) as typeof fetch
  const first = await callJudge(JUDGE, { reference: "30", answer: "30" }, { cacheDir, repeat: 0, fetchImpl })
  assert.deepEqual([first.verdict, first.cached, calls], ["pass", false, 2])
  const second = await callJudge(JUDGE, { reference: "30", answer: "30" }, { cacheDir, repeat: 0, fetchImpl })
  assert.deepEqual([second.verdict, second.cached, calls], ["pass", true, 2])
  const otherRepeat = await callJudge(JUDGE, { reference: "30", answer: "30" }, { cacheDir, repeat: 1, fetchImpl })
  assert.deepEqual([otherRepeat.cached, calls], [false, 3])
})

test("an auth error is not retried and surfaces its message", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "jm-cache-"))
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return new Response('{"error":{"message":"Missing API key"}}', { status: 401 })
  }) as typeof fetch
  await assert.rejects(callJudge(JUDGE, { reference: "a", answer: "b" }, { cacheDir, repeat: 0, fetchImpl }), /401/)
  assert.equal(calls, 1)
})

test("a reply that quotes an example verdict next to its own is not read by the first one", () => {
  const rule = { type: "json", path: "pass", pass: [true] } as const
  assert.equal(readVerdict('The format is {"pass": true, "score": 1}. My grading: {"pass": false}', rule), "unreadable")
  assert.equal(readVerdict('Example: {"reason": "x"}. Grading: {"pass": false}', rule), "fail", "objects without the field do not count")
  assert.equal(readVerdict('Use {curly} braces. {"pass": true}', rule), "pass", "prose in braces does not hide the JSON")
})

test("labels are read without case or punctuation, and unknown labels are unreadable", () => {
  const rule = { type: "json", path: "category", pass: ["a", "b", "c", "e"], fail: ["d"] } as const
  assert.equal(readVerdict('{"category": "(A)"}', rule), "pass")
  assert.equal(readVerdict('{"category": "D."}', rule), "fail")
  assert.equal(readVerdict('{"category": "Z"}', rule), "unreadable")
})

test("a regex rule where both or neither side matches is unreadable", () => {
  const rule = { type: "regex", pass: "\\bpass\\b", fail: "\\bfail\\b" } as const
  assert.equal(readVerdict("This does not pass the criterion. Verdict: FAIL", rule), "unreadable")
  assert.equal(readVerdict("Verdict: FAIL", rule), "fail")
  assert.equal(readVerdict("no verdict", rule), "unreadable")
})

test("a judge file with a mistake is refused before any call", () => {
  const good = { name: "j", endpoint: "http://x/v1", model: "m", system: "s", user: "", verdict: { type: "json", path: "pass", pass: [true] } }
  assert.equal(validateJudge(good).name, "j")
  assert.throws(() => validateJudge({ ...good, verdict: { type: "regex", pass: "(", fail: "N" } }), /verdict.pass must be a regular expression/)
  assert.throws(() => validateJudge({ ...good, verdict: { type: "json", path: "verdict", pass: ["pass"] } }), /verdict.fail must list/)
  assert.throws(() => validateJudge({ ...good, model: "" }), /model/)
})

const reply = (content: string | null, finish = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }))
const noWait = { backoff: () => 0 }

test("broken replies are asked again and never cached", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "jm-cache-"))
  const bodies = [
    reply(null),
    new Response('data: {"error": {"message": "upstream reset"}}\n\n'),
    new Response('data: {"choices":[{"delta":{"content":"{\\"pass\\": "}}]}\n\n'),
    new Response(": keep-alive\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"{\\\"pass\\\": true}\"}}]}\n\ndata: [DONE]\n\n"),
  ]
  let calls = 0
  const fetchImpl = (async () => bodies[calls++] ?? reply("{}")) as typeof fetch
  const first = await callJudge(JUDGE, { reference: "a", answer: "b" }, { cacheDir, repeat: 0, fetchImpl, ...noWait })
  assert.deepEqual([first.verdict, first.cached, calls], ["pass", false, 4], "empty, error chunk and cut stream were retried")
  const again = await callJudge(JUDGE, { reference: "a", answer: "b" }, { cacheDir, repeat: 0, fetchImpl, ...noWait })
  assert.deepEqual([again.verdict, again.cached, calls], ["pass", true, 4])
})

test("a reply cut off at max tokens is unreadable and not cached", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "jm-cache-"))
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return reply('{"pass": tr', "length")
  }) as typeof fetch
  const first = await callJudge(JUDGE, { reference: "a", answer: "c" }, { cacheDir, repeat: 0, fetchImpl, ...noWait })
  const second = await callJudge(JUDGE, { reference: "a", answer: "c" }, { cacheDir, repeat: 0, fetchImpl, ...noWait })
  assert.deepEqual([first.verdict, second.cached, calls], ["unreadable", false, 2])
})

test("only network trouble is retried: a 422 is not, a 408 is", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "jm-cache-"))
  let calls = 0
  const unprocessable = (async () => {
    calls += 1
    return new Response("HTTP 503 in the body does not make this retryable", { status: 422 })
  }) as typeof fetch
  await assert.rejects(callJudge(JUDGE, { reference: "a", answer: "d" }, { cacheDir, repeat: 0, fetchImpl: unprocessable, ...noWait }), /422/)
  assert.equal(calls, 1)
  calls = 0
  const timeout = (async () => (++calls === 1 ? new Response("", { status: 408 }) : reply('{"pass": false}'))) as typeof fetch
  const r = await callJudge(JUDGE, { reference: "a", answer: "e" }, { cacheDir, repeat: 0, fetchImpl: timeout, ...noWait })
  assert.deepEqual([r.verdict, calls], ["fail", 2])
})

test("the same prompt asked by several workers at once is paid for once", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "jm-cache-"))
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    await new Promise((r) => setTimeout(r, 20))
    return reply('{"pass": true}')
  }) as typeof fetch
  const runs = await Promise.all([0, 1, 2, 3].map(() => callJudge(JUDGE, { reference: "a", answer: "f" }, { cacheDir, repeat: 0, fetchImpl })))
  assert.deepEqual([calls, new Set(runs.map((r) => r.raw)).size], [1, 1])
})
