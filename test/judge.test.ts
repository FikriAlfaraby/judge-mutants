import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { callJudge, completionText, firstJsonObject, readVerdict, render } from "../src/judge.ts"
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
  const nested = { type: "json", path: "grounded.verdict", pass: ["pass"] } as const
  assert.equal(readVerdict('{"grounded": {"score": 5, "verdict": "PASS"}}', nested), "pass")
  assert.equal(readVerdict('{"grounded": {"score": 5, "verdict": "fail"}}', nested), "fail")
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
