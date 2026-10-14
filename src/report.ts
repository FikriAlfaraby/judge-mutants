import { firstJsonObject } from "./judge.ts"
import type { Judged } from "./run.ts"

export interface Row {
  operator: string
  kind: "wrong" | "control"
  /** Verdicts counted (cases whose original the judge passed). */
  judged: number
  passed: number
  unreadable: number
  /** passed / judged. For a wrong change this is the false-pass rate; for a control, the pass rate. */
  rate: number
}

export interface Example {
  caseId: string
  operator: string
  change: string
  text: string
  reason: string
}

export interface Report {
  judge: string
  cases: number
  /** The judge must pass the untouched answers, or its failures of changed ones mean nothing. */
  originals: { judged: number; passed: number; unreadable: number }
  rows: Row[]
  /** Wrong changes the judge passed, worst operators first, a few each. */
  falsePasses: Example[]
  /** Share of items whose verdict changed between repeats (0 with one repeat). */
  flaky: number
  /** Every reply of the run, counted or not, and how many could not be read. */
  replies: { total: number; unreadable: number }
}

/**
 * Turn verdicts into rates. A change is only counted when the judge passed that case's original on
 * the same repeat: if it already failed the correct answer, failing the wrong one proves nothing.
 */
export function summarize(judge: string, judged: Judged[]): Report {
  const originalPassed = new Set(judged.filter((j) => j.kind === "original" && j.verdict === "pass").map((j) => `${j.caseId}#${j.repeat}`))
  const originals = judged.filter((j) => j.kind === "original")
  const rows = new Map<string, Row>()
  for (const j of judged) {
    if (j.kind === "original" || !originalPassed.has(`${j.caseId}#${j.repeat}`)) continue
    const row = rows.get(j.operator) ?? { operator: j.operator, kind: j.kind, judged: 0, passed: 0, unreadable: 0, rate: 0 }
    if (j.verdict === "unreadable") row.unreadable += 1
    else {
      row.judged += 1
      if (j.verdict === "pass") row.passed += 1
    }
    rows.set(j.operator, row)
  }
  for (const row of rows.values()) row.rate = row.judged ? row.passed / row.judged : 0
  const ordered = [...rows.values()].sort((a, b) => (a.kind === b.kind ? b.rate - a.rate : a.kind === "wrong" ? -1 : 1))

  const falsePasses: Example[] = []
  for (const row of ordered.filter((r) => r.kind === "wrong")) {
    const hits = judged.filter((j) => j.operator === row.operator && j.verdict === "pass" && originalPassed.has(`${j.caseId}#${j.repeat}`))
    for (const j of hits.slice(0, 3)) falsePasses.push({ caseId: j.caseId, operator: j.operator, change: j.change, text: j.text, reason: reasonOf(j.raw) })
  }

  const byItem = new Map<string, Set<string>>()
  for (const j of judged) {
    const key = `${j.caseId}|${j.operator}|${j.text}`
    byItem.set(key, (byItem.get(key) ?? new Set()).add(j.verdict))
  }
  const repeats = new Set(judged.map((j) => j.repeat)).size
  const flaky = repeats > 1 ? [...byItem.values()].filter((v) => v.size > 1).length / Math.max(1, byItem.size) : 0

  return {
    judge,
    cases: new Set(judged.map((j) => j.caseId)).size,
    originals: {
      judged: originals.filter((j) => j.verdict !== "unreadable").length,
      passed: originals.filter((j) => j.verdict === "pass").length,
      unreadable: originals.filter((j) => j.verdict === "unreadable").length,
    },
    rows: ordered,
    falsePasses,
    flaky,
    replies: { total: judged.length, unreadable: judged.filter((j) => j.verdict === "unreadable").length },
  }
}

function reasonOf(raw: string): string {
  const parsed = firstJsonObject(raw)
  const reason = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).reason : undefined
  const text = typeof reason === "string" ? reason : raw
  return text.replace(/\s+/g, " ").trim().slice(0, 240)
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

export function toMarkdown(r: Report): string {
  const lines = [
    `# judge-mutants: ${r.judge}`,
    "",
    `${r.cases} cases. The judge passed ${r.originals.passed} of ${r.originals.judged} correct answers` +
      (r.originals.unreadable ? ` (${r.originals.unreadable} replies unreadable)` : "") +
      ". Changes are counted only where it passed the original.",
    "",
    "| Change | Kind | Judged | Passed | Rate | Unreadable |",
    "|---|---|---:|---:|---:|---:|",
    ...r.rows.map((x) => `| ${x.operator} | ${x.kind === "wrong" ? "wrong (should fail)" : "control (should pass)"} | ${x.judged} | ${x.passed} | ${pct(x.rate)} | ${x.unreadable} |`),
    "",
  ]
  if (r.flaky) lines.push(`Verdicts that changed between repeats: ${pct(r.flaky)} of items.`, "")
  if (r.falsePasses.length) {
    lines.push("## Wrong answers the judge passed", "")
    for (const e of r.falsePasses) lines.push(`- **${e.operator}** (${e.caseId}): ${e.change}. Judge: "${e.reason}"`)
    lines.push("")
  }
  return lines.join("\n")
}
