// Re-read every real judge reply from the runs with promptfoo's own parsers, and compare the verdict
// with judge-mutants' strict reading of the same reply. No model is called: a stub provider hands
// promptfoo the stored reply.
//
//   node reread.mjs ../../runs/squad [out.json]
//
// A disagreement means the same judge reply would have scored differently in promptfoo.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import promptfoo from "promptfoo"

const { assertions } = promptfoo
const stub = (reply) => ({ id: () => "judge-mutants-stub", callApi: async () => ({ output: reply }) })

// The judge configs that copy a promptfoo prompt, and the promptfoo matcher that reads its replies.
const MATCHERS = {
  "promptfoo-factuality": (raw) => assertions.matchesFactuality("q", "expert", "submitted", { provider: stub(raw) }),
  "openai-closedqa": (raw) => assertions.matchesClosedQa("q", "criterion", "submitted", { provider: stub(raw) }),
  "promptfoo-rubric": (raw) => assertions.matchesLlmRubric("rubric", "output", { provider: stub(raw) }),
}

const runs = process.argv[2] ?? "../../runs/squad"
const rows = []
const odd = []
for (const [prefix, match] of Object.entries(MATCHERS)) {
  for (const model of ["luna", "gemini"]) {
    const file = join(runs, `${prefix}.${model}`, "judged.jsonl")
    if (!existsSync(file)) continue
    const judged = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    const row = { judge: `${prefix}.${model}`, replies: judged.length, agree: 0, pfPassOursFail: 0, pfFailOursPass: 0, oursUnreadable: 0 }
    for (const j of judged) {
      const r = await match(j.raw)
      const pf = r.metadata?.graderError ? "grader error" : r.pass ? "pass" : "fail"
      if (j.verdict === "unreadable") row.oursUnreadable += 1
      if (pf === j.verdict) row.agree += 1
      else if (pf === "pass" && j.verdict === "fail") row.pfPassOursFail += 1
      else if (pf === "fail" && j.verdict === "pass") row.pfFailOursPass += 1
      if (pf !== j.verdict) odd.push({ judge: row.judge, caseId: j.caseId, operator: j.operator, ours: j.verdict, promptfoo: pf, raw: j.raw })
    }
    rows.push(row)
  }
}

console.log("judge                       replies  agree  pf-pass/ours-fail  pf-fail/ours-pass  ours-unreadable")
for (const r of rows) {
  console.log(`${r.judge.padEnd(27)} ${String(r.replies).padStart(7)} ${String(r.agree).padStart(6)} ${String(r.pfPassOursFail).padStart(18)} ${String(r.pfFailOursPass).padStart(18)} ${String(r.oursUnreadable).padStart(16)}`)
}
for (const o of odd) console.log(`\n${o.judge} ${o.caseId} ${o.operator}: ours ${o.ours}, promptfoo ${o.promptfoo}\n  ${JSON.stringify(o.raw).slice(0, 300)}`)
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ promptfoo: "0.124.1", rows, disagreements: odd }, null, 2) + "\n")
