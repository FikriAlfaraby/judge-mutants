// Feed promptfoo's real model-graded matchers judge replies whose meaning is unambiguous, through a
// stub grading provider (no model is called), and record the verdict promptfoo reaches.
//
//   npm install && node repro.mjs [out.json]   (pins promptfoo 0.124.1, see package.json)
//
// Each row says what the judge meant. A row where promptfoo's verdict differs from the judge's
// meaning is a parsing defect: the judge said FAIL and the test passed, or the reverse.
import { writeFileSync } from "node:fs"

import promptfoo from "promptfoo"

const { assertions } = promptfoo

const stub = (reply) => ({ id: () => "judge-mutants-stub", callApi: async () => ({ output: reply }) })

const QUESTION = "In what country is Normandy located?"
const EXPERT = "France"
const SUBMITTED = "Normandy is a region in Belgium."

const rows = [
  // factuality: the judge is asked for JSON {"category": A-E}; D (disagreement) is the only failing category.
  { matcher: "factuality", meant: "fail", reply: '{"category": "D", "reason": "The submission says Belgium; the expert answer says France."}' },
  { matcher: "factuality", meant: "fail", reply: "D) There is a disagreement between the submitted answer and the expert answer." },
  { matcher: "factuality", meant: "fail", reply: "There is a disagreement: the submitted answer names the wrong country (Belgium instead of France). Category D." },
  { matcher: "factuality", meant: "fail", reply: "Category: D. The submission contradicts the expert answer (wrong name)." },
  { matcher: "factuality", meant: "pass", reply: '{"category": "C", "reason": "Same details."}' },
  // model-graded-closedqa: the prompt asks for Y or N on its own line, twice.
  { matcher: "closedqa", meant: "fail", reply: "The submission names Belgium, but Normandy is in France.\nN\nN" },
  { matcher: "closedqa", meant: "fail", reply: "The submission names Belgium, but Normandy is in France, so the criterion is not met.\nVerdict: UNSATISFACTORY" },
  { matcher: "closedqa", meant: "fail", reply: "The submission gets the country wrong. Answer: NO, NOT SATISFACTORY" },
  { matcher: "closedqa", meant: "pass", reply: "The submission names France.\nY\nY" },
]

const results = []
for (const row of rows) {
  const grading = { provider: stub(row.reply) }
  const r =
    row.matcher === "factuality"
      ? await assertions.matchesFactuality(QUESTION, EXPERT, SUBMITTED, grading)
      : await assertions.matchesClosedQa(QUESTION, `The answer is ${EXPERT}`, SUBMITTED, grading)
  const verdict = r.metadata?.graderError ? "grader error" : r.pass ? "pass" : "fail"
  results.push({ ...row, verdict, defect: verdict === "pass" && row.meant === "fail" ? "PASSES A FAIL" : verdict === "fail" && row.meant === "pass" ? "FAILS A PASS" : "" })
}

for (const r of results) {
  console.log(`${r.matcher.padEnd(10)} meant ${r.meant.padEnd(4)} -> ${r.verdict.padEnd(12)} ${r.defect.padEnd(14)} ${JSON.stringify(r.reply).slice(0, 110)}`)
}
const defects = results.filter((r) => r.defect)
console.log(`\n${defects.length} of ${results.length} replies read against their meaning (promptfoo ${promptfoo.version ?? "0.124.1"})`)
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ promptfoo: "0.124.1", rows: results }, null, 2) + "\n")
