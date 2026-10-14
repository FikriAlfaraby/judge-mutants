// Collect every finished run into docs/results.json and docs/results.md, so no number in the
// write-up or on the site is typed by hand.
//
//   node scripts/results.ts
import { existsSync, readdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { firstJsonObject } from "../src/judge.ts"
import type { JudgeConfig } from "../src/judge.ts"
import type { Case, Judged } from "../src/run.ts"

interface Family {
  label: string
  /** Whether the judge sees the correct answer. */
  reference: boolean
  source: string
}

const FAMILIES: Record<string, Family> = {
  "promptfoo-rubric": { label: "promptfoo llm-rubric", reference: true, source: "promptfoo's default llm-rubric prompt, the correct answer written into the rubric" },
  "promptfoo-factuality": { label: "promptfoo factuality", reference: true, source: "promptfoo's factuality prompt (categories A-E, D fails)" },
  "openai-closedqa": { label: "OpenAI closed-QA", reference: true, source: "OpenAI's closed-QA prompt as shipped in promptfoo (Y/N)" },
  strict: { label: "Strict (mine)", reference: true, source: "a strict prompt of my own: any wrong name, number, date or unit fails" },
  "noref-rubric": { label: "promptfoo llm-rubric, no answer key", reference: false, source: 'the same llm-rubric prompt with the rubric "The output correctly answers this question", no correct answer given' },
  "noref-strict": { label: "Strict, no answer key", reference: false, source: "my strict prompt, judging from the model's own knowledge" },
  "walead-grounded": { label: "wa-lead grounded check", reference: true, source: "wa-lead-extractor's own judge prompt; only its grounded verdict is read" },
}

const MODELS: Record<string, string> = { "cx/gpt-6-luna": "GPT-6 Luna", "ag/gemini-3.8-flash": "Gemini 3.8 Flash" }

interface Count {
  judged: number
  passed: number
  unreadable: number
}

interface Shown {
  caseId: string
  operator: string
  change: string
  question: string
  reference: string
  /** The correct answer before the change, so a page can show exactly what moved. */
  original: string
  answer: string
  reason: string
}

interface JudgeResult {
  name: string
  dataset: string
  family: string
  label: string
  model: string
  reference: boolean
  originals: Count
  wrong: Count
  controls: Count
  byOperator: Record<string, Count & { kind: string }>
  /** Wrong answers it passed, rejected correct answers, and failed controls, with its reasons. */
  falsePasses: Shown[]
  rejectedOriginals: Shown[]
  failedControls: Shown[]
}

const empty = (): Count => ({ judged: 0, passed: 0, unreadable: 0 })

function add(count: Count, verdict: string): void {
  if (verdict === "unreadable") count.unreadable += 1
  else {
    count.judged += 1
    if (verdict === "pass") count.passed += 1
  }
}

function reasonOf(raw: string): string {
  const parsed = firstJsonObject(raw)
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  const reason = record?.reason
  const text = typeof reason === "string" ? reason : raw
  return text.replace(/\s+/g, " ").trim().slice(0, 400)
}

async function readJsonl<T>(path: string): Promise<T[]> {
  return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)
}

async function judgeResult(dataset: string, dir: string, name: string, cases: Map<string, Case>): Promise<JudgeResult> {
  const config = JSON.parse(await readFile(join("judges", `${name}.json`), "utf8")) as JudgeConfig
  const familyId = name.replace(/\.(luna|gemini)$/, "")
  const family = FAMILIES[familyId]
  if (!family) throw new Error(`no family for judge ${name}`)
  const judged = (await readJsonl<Judged>(join(dir, name, "judged.jsonl"))).filter((j) => j.repeat === 0)
  const passedOriginal = new Set(judged.filter((j) => j.kind === "original" && j.verdict === "pass").map((j) => j.caseId))
  const result: JudgeResult = {
    name,
    dataset,
    family: familyId,
    label: family.label,
    model: MODELS[config.model] ?? config.model,
    reference: family.reference,
    originals: empty(),
    wrong: empty(),
    controls: empty(),
    byOperator: {},
    falsePasses: [],
    rejectedOriginals: [],
    failedControls: [],
  }
  for (const j of judged) {
    const c = cases.get(j.caseId)
    const shown = (): Shown => ({
      caseId: j.caseId,
      operator: j.operator,
      change: j.change,
      question: c?.vars?.question ?? "",
      reference: c?.reference ?? "",
      original: c?.answer ?? "",
      answer: j.text,
      reason: reasonOf(j.raw),
    })
    if (j.kind === "original") {
      add(result.originals, j.verdict)
      if (j.verdict === "fail") result.rejectedOriginals.push(shown())
      continue
    }
    // A change counts only where the judge passed the untouched answer.
    if (!passedOriginal.has(j.caseId)) continue
    add(j.kind === "wrong" ? result.wrong : result.controls, j.verdict)
    const op = (result.byOperator[j.operator] ??= { ...empty(), kind: j.kind })
    add(op, j.verdict)
    if (j.kind === "wrong" && j.verdict === "pass") result.falsePasses.push(shown())
    if (j.kind === "control" && j.verdict === "fail") result.failedControls.push(shown())
  }
  return result
}

/** One wrong answer and what every judge that passed its original said about it. */
interface WrongItem {
  dataset: string
  caseId: string
  operator: string
  change: string
  question: string
  reference: string
  original: string
  answer: string
  /** Judge name -> verdict, only for judges that passed the untouched answer. */
  verdicts: Record<string, string>
  /** Judge name -> reason, for the judges that passed it. */
  reasons: Record<string, string>
}

async function wrongItems(dataset: string, dir: string, names: string[], cases: Map<string, Case>): Promise<WrongItem[]> {
  const items = new Map<string, WrongItem>()
  for (const name of names) {
    const judged = (await readJsonl<Judged>(join(dir, name, "judged.jsonl"))).filter((j) => j.repeat === 0)
    const passedOriginal = new Set(judged.filter((j) => j.kind === "original" && j.verdict === "pass").map((j) => j.caseId))
    for (const j of judged) {
      if (j.kind !== "wrong" || !passedOriginal.has(j.caseId)) continue
      const c = cases.get(j.caseId)
      const key = `${j.caseId}|${j.operator}|${j.text}`
      const item = items.get(key) ?? {
        dataset,
        caseId: j.caseId,
        operator: j.operator,
        change: j.change,
        question: c?.vars?.question ?? "",
        reference: c?.reference ?? "",
        original: c?.answer ?? "",
        answer: j.text,
        verdicts: {},
        reasons: {},
      }
      item.verdicts[name] = j.verdict
      if (j.verdict === "pass") item.reasons[name] = reasonOf(j.raw)
      items.set(key, item)
    }
  }
  return [...items.values()]
}

interface Stability {
  name: string
  repeats: number
  items: number
  /** Items whose verdict was not the same on every repeat. */
  changed: number
  /** Wrong answers passed on every repeat, on some repeats, and never (original passed every time). */
  alwaysPassed: number
  sometimesPassed: number
}

async function stability(dir: string, name: string): Promise<Stability | null> {
  const file = join(dir, name, "judged.jsonl")
  if (!existsSync(file)) return null
  const judged = await readJsonl<Judged>(file)
  const repeats = [...new Set(judged.map((j) => j.repeat))]
  const verdicts = new Map<string, Set<string>>()
  for (const j of judged) verdicts.set(`${j.caseId}|${j.operator}|${j.text}`, (verdicts.get(`${j.caseId}|${j.operator}|${j.text}`) ?? new Set()).add(j.verdict))
  // The same rule as a single run: a wrong answer counts in a repeat only if that repeat passed its original.
  const passedPerRepeat = repeats.map((r) => {
    const originals = new Set(judged.filter((j) => j.repeat === r && j.kind === "original" && j.verdict === "pass").map((j) => j.caseId))
    return new Set(judged.filter((j) => j.repeat === r && j.kind === "wrong" && j.verdict === "pass" && originals.has(j.caseId)).map((j) => `${j.caseId}|${j.operator}|${j.text}`))
  })
  const ever = new Set(passedPerRepeat.flatMap((p) => [...p]))
  const always = [...ever].filter((k) => passedPerRepeat.every((p) => p.has(k))).length
  return {
    name,
    repeats: repeats.length,
    items: verdicts.size,
    changed: [...verdicts.values()].filter((v) => v.size > 1).length,
    alwaysPassed: always,
    sometimesPassed: ever.size - always,
  }
}

const pct = (c: Count) => (c.judged ? `${Math.round((c.passed / c.judged) * 1000) / 10}%` : "-")
const frac = (c: Count) => `${c.passed} of ${c.judged}`

function markdown(results: JudgeResult[], stable: Stability[]): string {
  const out = [
    "# Results",
    "",
    "Generated by `node scripts/results.ts` from the runs in `runs/`. Every number links back to a",
    "verdict in a `judged.jsonl` file. Changes are counted only where the judge passed the untouched",
    "answer. One run per judge at temperature 0, unless stated.",
    "",
  ]
  for (const dataset of [...new Set(results.map((r) => r.dataset))]) {
    const rows = results.filter((r) => r.dataset === dataset)
    out.push(`## ${dataset}`, "", "| Judge | Model | Answer key | Correct answers passed | Wrong answers passed | Controls passed |", "|---|---|---|---:|---:|---:|")
    for (const r of rows) {
      out.push(`| ${r.label} | ${r.model} | ${r.reference ? "yes" : "no"} | ${frac(r.originals)} | ${frac(r.wrong)} (${pct(r.wrong)}) | ${frac(r.controls)} (${pct(r.controls)}) |`)
    }
    out.push("")
    for (const r of rows) {
      if (!r.falsePasses.length && !r.rejectedOriginals.length && !r.failedControls.length) continue
      out.push(`### ${r.label}, ${r.model}`, "")
      for (const e of r.falsePasses) out.push(`- Passed a wrong answer (${e.operator}: ${e.change}). Question: ${e.question} Judge: "${e.reason}"`)
      for (const e of r.rejectedOriginals) out.push(`- Failed a correct answer. Question: ${e.question} Judge: "${e.reason}"`)
      for (const e of r.failedControls) out.push(`- Failed a harmless edit (${e.operator}: ${e.change}). Judge: "${e.reason}"`)
      out.push("")
    }
  }
  if (stable.length) {
    out.push("## Repeats", "", "| Judge | Repeats | Items | Verdict changed | Wrong passed every time | Wrong passed sometimes |", "|---|---:|---:|---:|---:|---:|")
    for (const s of stable) out.push(`| ${s.name} | ${s.repeats} | ${s.items} | ${s.changed} | ${s.alwaysPassed} | ${s.sometimesPassed} |`)
    out.push("")
  }
  return out.join("\n")
}

async function main(): Promise<void> {
  const results: JudgeResult[] = []
  const items: WrongItem[] = []
  for (const dataset of ["squad", "walead"]) {
    const dir = join("runs", dataset)
    if (!existsSync(dir)) continue
    const cases = new Map((await readJsonl<Case>(join("data", dataset, "cases.jsonl"))).map((c) => [c.id, c]))
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "judged.jsonl")))
      .map((d) => d.name)
      .sort((a, b) => Object.keys(FAMILIES).indexOf(a.replace(/\.\w+$/, "")) - Object.keys(FAMILIES).indexOf(b.replace(/\.\w+$/, "")) || a.localeCompare(b))
    for (const name of names) results.push(await judgeResult(dataset, dir, name, cases))
    items.push(...(await wrongItems(dataset, dir, names, cases)))
  }
  const stable: Stability[] = []
  if (existsSync(join("runs", "squad-repeats"))) {
    for (const d of readdirSync(join("runs", "squad-repeats"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const s = await stability(join("runs", "squad-repeats"), d.name)
      if (s) stable.push(s)
    }
  }
  await writeFile(join("docs", "results.json"), JSON.stringify({ judges: results, wrongItems: items, repeats: stable }, null, 2) + "\n")
  await writeFile(join("docs", "results.md"), markdown(results, stable))
  process.stdout.write(`${results.length} judge runs, ${stable.length} repeat runs -> docs/results.json, docs/results.md\n`)
}

await main()
