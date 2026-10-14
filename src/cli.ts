#!/usr/bin/env node
// judge-mutants: how often does your LLM judge pass a wrong answer?
//
//   judge-mutants plan --cases cases.jsonl [--operators number,entity] [--show]
//   judge-mutants run  --cases cases.jsonl --judge judge.json [--repeats 1] [--concurrency 4]
//                      [--operators ...] [--limit N] [--out runs/name] [--max-false-pass 0.1]
//
// Exit code 1 when any wrong change passes more often than --max-false-pass, so it can gate CI.
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"

import { KIND } from "./operators.ts"
import { summarize, toMarkdown } from "./report.ts"
import { judgeAll, plan } from "./run.ts"
import type { JudgeConfig } from "./judge.ts"
import type { OperatorId } from "./operators.ts"
import type { Case, Exclusion } from "./run.ts"

async function readCases(path: string, limit?: number): Promise<Case[]> {
  const lines = (await readFile(path, "utf8")).split("\n").filter((l) => l.trim())
  const cases = lines.map((line, i) => {
    const c = JSON.parse(line) as Partial<Case>
    if (!c.id || typeof c.answer !== "string" || typeof c.reference !== "string") {
      throw new Error(`${path}:${i + 1}: each case needs id, answer and reference`)
    }
    return c as Case
  })
  return limit ? cases.slice(0, limit) : cases
}

function operatorList(value: string | undefined): OperatorId[] | undefined {
  if (!value) return undefined
  const ids = value.split(",").map((s) => s.trim()) as OperatorId[]
  for (const id of ids) if (!(id in KIND)) throw new Error(`unknown operator "${id}"; known: ${Object.keys(KIND).join(", ")}`)
  return ids
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const { values } = parseArgs({
    args: rest,
    options: {
      cases: { type: "string" },
      judge: { type: "string" },
      operators: { type: "string" },
      repeats: { type: "string", default: "1" },
      concurrency: { type: "string", default: "4" },
      limit: { type: "string" },
      out: { type: "string" },
      "max-false-pass": { type: "string", default: "0.1" },
      show: { type: "boolean", default: false },
    },
  })
  if (!values.cases || (command !== "plan" && command !== "run")) {
    process.stderr.write("usage: judge-mutants plan|run --cases cases.jsonl [--judge judge.json] ...\n")
    return 2
  }
  const cases = await readCases(values.cases, values.limit ? Number(values.limit) : undefined)
  // An excluded.json next to the cases lists wrong answers left out after a hand audit, with reasons.
  const exclusionsFile = join(dirname(values.cases), "excluded.json")
  const excluded = existsSync(exclusionsFile) ? (JSON.parse(await readFile(exclusionsFile, "utf8")) as Exclusion[]) : []
  const items = plan(cases, operatorList(values.operators), excluded)

  if (command === "plan") {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.operator, (counts.get(item.operator) ?? 0) + 1)
    process.stdout.write(`${cases.length} cases, ${items.length} answers to judge\n`)
    for (const [op, n] of counts) process.stdout.write(`  ${op.padEnd(9)} ${n}\n`)
    if (!values.show) {
      for (const item of items.slice(0, 12)) if (item.kind !== "original") process.stdout.write(`  ${item.caseId} ${item.operator}: ${item.change}\n`)
      return 0
    }
    // --show prints every changed answer in full, for the hand audit before any judge runs.
    const references = new Map(cases.map((c) => [c.id, c.reference]))
    for (const item of items) {
      if (item.kind === "original") continue
      process.stdout.write(`\n[${item.caseId}] ${item.kind} ${item.operator}: ${item.change}\n  reference: ${references.get(item.caseId)}\n  answer:    ${item.text}\n`)
    }
    return 0
  }

  if (!values.judge) throw new Error("run needs --judge judge.json")
  const judge = JSON.parse(await readFile(values.judge, "utf8")) as JudgeConfig
  const out = values.out ?? join("runs", judge.name)
  await mkdir(out, { recursive: true })
  const judged = await judgeAll(judge, cases, items, {
    repeats: Number(values.repeats),
    concurrency: Number(values.concurrency),
    cacheDir: join("runs", "cache", judge.name),
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) process.stderr.write(`\r${judge.name}: ${done}/${total}`)
    },
  })
  process.stderr.write("\n")
  const report = summarize(judge.name, judged)
  await writeFile(join(out, "judged.jsonl"), judged.map((j) => JSON.stringify(j)).join("\n") + "\n")
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n")
  const markdown = toMarkdown(report)
  await writeFile(join(out, "report.md"), markdown)
  process.stdout.write(markdown)

  const limit = Number(values["max-false-pass"])
  const worst = report.rows.filter((r) => r.kind === "wrong" && r.rate > limit)
  return worst.length ? 1 : 0
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`judge-mutants: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(2)
  },
)
