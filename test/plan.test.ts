import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

import { plan } from "../src/run.ts"
import type { OperatorId } from "../src/operators.ts"
import type { Case, Exclusion, Judged } from "../src/run.ts"

const lines = <T>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)

// The published results are only true of the code that made them. If an operator change alters
// what the judges would be asked, this fails until the runs are redone.
const PUBLISHED: [dataset: string, judge: string, operators?: OperatorId[]][] = [
  ["squad", "strict.luna"],
  ["walead", "walead-grounded.luna", ["number", "unit", "entity", "date", "term", "reformat", "filler"]],
]

for (const [dataset, judge, operators] of PUBLISHED) {
  test(`today's ${dataset} plan is exactly what the published ${judge} run judged`, () => {
    const cases = lines<Case>(`data/${dataset}/cases.jsonl`)
    const exclusions = `data/${dataset}/excluded.json`
    const excluded = existsSync(exclusions) ? (JSON.parse(readFileSync(exclusions, "utf8")) as Exclusion[]) : []
    const planned = plan(cases, operators, excluded).map((i) => `${i.caseId}|${i.operator}|${i.text}`)
    const judged = lines<Judged>(`runs/${dataset}/${judge}/judged.jsonl`)
      .filter((j) => j.repeat === 0)
      .map((j) => `${j.caseId}|${j.operator}|${j.text}`)
    assert.deepEqual(planned.sort(), judged.sort())
  })
}
