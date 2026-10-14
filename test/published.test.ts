import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { readVerdict, validateJudge } from "../src/judge.ts"
import type { Judged } from "../src/run.ts"

// Every reply in the published runs, read again with today's reader, must give the verdict that
// was published. A change to how verdicts are read cannot quietly rewrite the results.
for (const dataset of ["squad", "walead", "squad-repeats"]) {
  const dir = join("runs", dataset)
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir).filter((n) => existsSync(join(dir, n, "judged.jsonl")))) {
    test(`published ${dataset}/${name} replies read the same today`, () => {
      const judge = validateJudge(JSON.parse(readFileSync(join("judges", `${name}.json`), "utf8")), name)
      const judged = readFileSync(join(dir, name, "judged.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Judged)
      const changed = judged.filter((j) => readVerdict(j.raw, judge.verdict) !== j.verdict)
      assert.deepEqual(changed.map((j) => `${j.caseId} ${j.operator}: ${j.verdict} -> ${readVerdict(j.raw, judge.verdict)}`), [])
    })
  }
}
