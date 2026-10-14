#!/usr/bin/env node
// judge-mutants: how often does your LLM judge pass a wrong answer?
//
//   judge-mutants plan --cases cases.jsonl [--operators number,entity] [--show]
//   judge-mutants run  --cases cases.jsonl --judge judge.json [--repeats 1] [--concurrency 4]
//                      [--operators ...] [--limit N] [--out runs/name]
//                      [--max-false-pass 0.1] [--min-original-pass 0.8] [--max-unreadable 0.1]
//
// Exit code 1 when the gate fails: a wrong change passes more often than --max-false-pass, the
// judge passes too few of the untouched answers to measure anything, too many replies are
// unreadable, or nothing was measured at all. Exit code 2 for a usage or input error.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { gateProblems } from "./gate.ts"
import { operatorList, readCases, readExclusions, share, UsageError, wholeNumber } from "./inputs.ts"
import { validateJudge } from "./judge.ts"
import { summarize, toMarkdown } from "./report.ts"
import { judgeAll, plan } from "./run.ts"

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
      "min-original-pass": { type: "string", default: "0.8" },
      "max-unreadable": { type: "string", default: "0.1" },
      show: { type: "boolean", default: false },
    },
  })
  if (!values.cases || (command !== "plan" && command !== "run")) {
    throw new UsageError("usage: judge-mutants plan|run --cases cases.jsonl [--judge judge.json] ...")
  }
  const only = operatorList(values.operators)
  const cases = await readCases(values.cases, wholeNumber("limit", values.limit, 1))
  const excluded = await readExclusions(values.cases, cases, only)
  const items = plan(cases, only, excluded)

  if (command === "plan") {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.operator, (counts.get(item.operator) ?? 0) + 1)
    const out = [`${cases.length} cases, ${items.length} answers to judge`, ...[...counts].map(([op, n]) => `  ${op.padEnd(9)} ${n}`)]
    if (!values.show) {
      for (const item of items.slice(0, 12)) if (item.kind !== "original") out.push(`  ${item.caseId} ${item.operator}: ${item.change}`)
    } else {
      // --show prints every changed answer in full, for the hand audit before any judge runs.
      const references = new Map(cases.map((c) => [c.id, c.reference]))
      for (const item of items) {
        if (item.kind === "original") continue
        out.push("", `[${item.caseId}] ${item.kind} ${item.operator}: ${item.change}`, `  reference: ${references.get(item.caseId)}`, `  answer:    ${item.text}`)
      }
    }
    process.stdout.write(`${out.join("\n")}\n`)
    return 0
  }

  if (!values.judge) throw new UsageError("run needs --judge judge.json")
  const judge = validateJudge(JSON.parse(await readFile(values.judge, "utf8")), values.judge)
  const gate = {
    maxFalsePass: share("max-false-pass", values["max-false-pass"]),
    minOriginalPass: share("min-original-pass", values["min-original-pass"]),
    maxUnreadable: share("max-unreadable", values["max-unreadable"]),
  }
  const repeats = wholeNumber("repeats", values.repeats, 1) ?? 1
  const concurrency = wholeNumber("concurrency", values.concurrency, 1) ?? 4
  const out = values.out ?? join("runs", judge.name)
  await mkdir(out, { recursive: true })
  const judged = await judgeAll(judge, cases, items, {
    repeats,
    concurrency,
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

  const problems = gateProblems(report, gate)
  process.stderr.write(problems.length ? `gate: FAIL\n${problems.map((p) => `  ${p}`).join("\n")}\n` : "gate: pass\n")
  return problems.length ? 1 : 0
}

// Exit only after the output has drained: a slow pipe must still get every line.
const exit = (code: number) => process.stdout.write("", () => process.exit(code))

main(process.argv.slice(2)).then(exit, (err: unknown) => {
  process.stderr.write(`judge-mutants: ${err instanceof Error ? err.message : String(err)}\n`)
  exit(2)
})
