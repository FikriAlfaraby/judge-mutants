import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { gateProblems } from "../src/gate.ts"
import { readCases, readExclusions, share, wholeNumber } from "../src/inputs.ts"
import { summarize } from "../src/report.ts"
import type { Judged } from "../src/run.ts"

const GATE = { maxFalsePass: 0.1, minOriginalPass: 0.8, maxUnreadable: 0.1 }
const item = (caseId: string, operator: Judged["operator"], kind: Judged["kind"], verdict: Judged["verdict"]): Judged => ({
  caseId,
  operator,
  kind,
  change: "",
  text: `${caseId} ${operator}`,
  repeat: 0,
  verdict,
  raw: "",
})

test("a judge that measured something and caught it passes the gate", () => {
  const report = summarize("j", [item("a", "original", "original", "pass"), item("a", "number", "wrong", "fail"), item("a", "filler", "control", "pass")])
  assert.deepEqual(gateProblems(report, GATE), [])
})

test("the gate fails when nothing was measured", () => {
  const failsEverything = summarize("j", [item("a", "original", "original", "fail"), item("a", "number", "wrong", "fail")])
  const problems = gateProblems(failsEverything, GATE)
  assert.ok(problems.some((p) => /nothing was measured/.test(p)))
  assert.ok(problems.some((p) => /passed 0 of 1 correct answers/.test(p)))
  const unreadable = summarize("j", [item("a", "original", "original", "unreadable"), item("a", "number", "wrong", "unreadable")])
  assert.ok(gateProblems(unreadable, GATE).some((p) => /2 of 2 replies were unreadable/.test(p)))
})

test("the gate fails when a wrong change passes too often", () => {
  const report = summarize("j", [item("a", "original", "original", "pass"), item("a", "number", "wrong", "pass")])
  assert.deepEqual(gateProblems(report, GATE), ["number: 1 of 1 wrong answers passed (above 10%)"])
})

test("numeric flags are checked, never read as NaN", () => {
  assert.throws(() => share("max-false-pass", "0,05"), /between 0 and 1/)
  assert.throws(() => share("max-false-pass", "abc"), /between 0 and 1/)
  assert.equal(share("max-false-pass", "0.05"), 0.05)
  assert.throws(() => wholeNumber("repeats", "0", 1), /at least 1/)
  assert.throws(() => wholeNumber("concurrency", "abc", 1), /whole number/)
  assert.equal(wholeNumber("limit", undefined, 1), undefined)
})

async function casesFile(lines: unknown[], exclusions?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jm-cases-"))
  await writeFile(join(dir, "cases.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"))
  if (exclusions) await writeFile(join(dir, "excluded.json"), JSON.stringify(exclusions))
  return join(dir, "cases.jsonl")
}

test("cases with a duplicate id or a bad field are refused", async () => {
  const twice = await casesFile([
    { id: "q1", answer: "Paris is the capital of France.", reference: "Paris" },
    { id: "q1", answer: "Rome is the capital of Italy.", reference: "Rome" },
  ])
  await assert.rejects(readCases(twice), /used twice/)
  const objectVar = await casesFile([{ id: "q1", answer: "a", reference: "b", vars: { question: { text: "?" } } }])
  await assert.rejects(readCases(objectVar), /vars must map names to strings/)
})

test("an exclusion that matches no answer is stale and refused", async () => {
  const path = await casesFile([{ id: "q1", answer: "Paris is the capital of France.", reference: "Paris" }], [
    { caseId: "q1", operator: "number", reason: "there is no number to change" },
  ])
  const cases = await readCases(path)
  await assert.rejects(readExclusions(path, cases, undefined), /q1 number matches no answer/)
  assert.deepEqual(await readExclusions(path, cases, ["entity"]), [{ caseId: "q1", operator: "number", reason: "there is no number to change" }])
})
