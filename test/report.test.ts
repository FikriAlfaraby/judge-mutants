import assert from "node:assert/strict"
import { test } from "node:test"

import { summarize, toMarkdown } from "../src/report.ts"
import type { Judged } from "../src/run.ts"

const j = (caseId: string, operator: Judged["operator"], kind: Judged["kind"], verdict: Judged["verdict"], repeat = 0): Judged => ({
  caseId,
  operator,
  kind,
  verdict,
  repeat,
  change: operator === "original" ? "" : `${operator} change`,
  text: `${caseId}-${operator}`,
  raw: `{"pass": ${verdict === "pass"}, "reason": "because ${operator}"}`,
})

test("changes count only where the judge passed the original", () => {
  const report = summarize("demo", [
    j("a", "original", "original", "pass"),
    j("a", "number", "wrong", "pass"),
    j("a", "entity", "wrong", "fail"),
    j("a", "filler", "control", "pass"),
    j("b", "original", "original", "fail"),
    j("b", "number", "wrong", "fail"),
    j("c", "original", "original", "pass"),
    j("c", "number", "wrong", "fail"),
    j("c", "entity", "wrong", "unreadable"),
  ])
  assert.deepEqual(report.originals, { judged: 3, passed: 2, unreadable: 0 })
  const row = (op: string) => report.rows.find((r) => r.operator === op)
  assert.deepEqual([row("number")?.judged, row("number")?.passed, row("number")?.rate], [2, 1, 0.5])
  assert.deepEqual([row("entity")?.judged, row("entity")?.unreadable], [1, 1])
  assert.equal(row("filler")?.rate, 1)
  assert.equal(report.rows[0]?.operator, "number", "worst wrong change first")
  assert.deepEqual(report.falsePasses.map((e) => [e.caseId, e.operator, e.reason]), [["a", "number", "because number"]])
  assert.match(toMarkdown(report), /\| number \| wrong \(should fail\) \| 2 \| 1 \| 50% \| 0 \|/)
})

test("flakiness is the share of items whose verdict changed between repeats", () => {
  const report = summarize("demo", [
    j("a", "original", "original", "pass", 0),
    j("a", "original", "original", "pass", 1),
    j("a", "number", "wrong", "pass", 0),
    j("a", "number", "wrong", "fail", 1),
  ])
  assert.equal(report.flaky, 0.5)
})
