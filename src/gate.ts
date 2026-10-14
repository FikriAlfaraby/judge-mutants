// When a run fails: the exit code a CI job reads.
import type { Report } from "./report.ts"

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

export interface Gate {
  maxFalsePass: number
  minOriginalPass: number
  maxUnreadable: number
}

/** Why a run fails its gate; empty when it passes. A run that measured nothing never passes. */
export function gateProblems(report: Report, gate: Gate): string[] {
  const problems: string[] = []
  // An unreadable reply to a correct answer is not a pass either.
  const { judged, passed, unreadable } = report.originals
  const originals = judged + unreadable
  if (!originals || passed / originals < gate.minOriginalPass) {
    problems.push(`the judge passed ${passed} of ${originals} correct answers (below ${pct(gate.minOriginalPass)}), so its failures of wrong ones mean little`)
  }
  const { total, unreadable: unread } = report.replies
  if (total && unread / total > gate.maxUnreadable) problems.push(`${unread} of ${total} replies were unreadable (above ${pct(gate.maxUnreadable)})`)
  const wrong = report.rows.filter((r) => r.kind === "wrong")
  if (!wrong.some((r) => r.judged > 0)) problems.push("nothing was measured: no wrong answer was judged after its original passed")
  for (const r of wrong) {
    if (r.rate > gate.maxFalsePass) problems.push(`${r.operator}: ${r.passed} of ${r.judged} wrong answers passed (above ${pct(gate.maxFalsePass)})`)
  }
  return problems
}
