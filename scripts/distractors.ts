// Ask a model for same-kind wrong values for each case's reference, once, and store them in the
// case file. The values are then read and corrected by hand before any judge runs; the file in the
// repo is the audited version, so a run never depends on this script or on the model.
//
//   JM_KEY=... node scripts/distractors.ts data/squad/cases.jsonl http://127.0.0.1:20128/v1 cx/gpt-6-luna
import { readFile, writeFile } from "node:fs/promises"

import { completionText, firstJsonObject } from "../src/judge.ts"
import type { Case } from "../src/run.ts"

const [file, endpoint, model] = process.argv.slice(2)
if (!file || !endpoint || !model) throw new Error("usage: distractors.ts cases.jsonl endpoint model")
const key = process.env.JM_KEY

const PROMPT = `You help build a test set for answer graders. Given a question and its correct answer, give three
different values that are wrong answers of the SAME KIND as the correct answer (a team for a team, a
country for a country, a prize for a prize, a person for a person), plausible enough that a careless
reader might accept them. Never give a value that is also correct. Reply with JSON only:
{"distractors": ["...", "...", "..."]}`

const cases = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Case)
for (const c of cases) {
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      temperature: 0,
      stream: false,
      max_tokens: 200,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: `Question: ${c.vars?.question ?? ""}\nCorrect answer: ${c.reference}` },
      ],
    }),
  })
  const parsed = firstJsonObject(completionText(await res.text())) as { distractors?: unknown } | undefined
  const list = Array.isArray(parsed?.distractors) ? parsed.distractors.filter((d): d is string => typeof d === "string") : []
  c.distractors = list
  process.stderr.write(`${c.id}: ${c.reference} -> ${list.join(" | ")}\n`)
}
await writeFile(file, cases.map((c) => JSON.stringify(c)).join("\n") + "\n")
