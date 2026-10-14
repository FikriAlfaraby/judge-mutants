import { callJudge } from "./judge.ts"
import { mutate } from "./operators.ts"
import { entities } from "./text.ts"
import type { JudgeConfig, Verdict } from "./judge.ts"
import type { OperatorId } from "./operators.ts"

/** One graded example: a correct answer and what it must agree with. */
export interface Case {
  id: string
  answer: string
  reference: string
  /** Extra template slots, e.g. the question. {{answer}} and {{reference}} are filled for you. */
  vars?: Record<string, string>
  /** Other values of the same kind as the reference, used first when a name is swapped. */
  distractors?: string[]
}

export type ItemKind = "original" | "wrong" | "control"

/** One answer to put in front of the judge: the original, or one change to it. */
export interface Item {
  caseId: string
  operator: OperatorId | "original"
  kind: ItemKind
  change: string
  text: string
}

export interface Judged extends Item {
  repeat: number
  verdict: Verdict
  raw: string
}

/** Proper nouns across the dataset, so a swapped name is a real name from the same domain. */
export function entityPool(cases: Case[]): string[] {
  const seen = new Set<string>()
  for (const c of cases) for (const e of [...entities(c.reference), ...entities(c.answer)]) seen.add(e.text)
  return [...seen].sort()
}

/** A wrong answer read by hand before any judge ran and left out, with the reason. */
export interface Exclusion {
  caseId: string
  operator: OperatorId
  reason: string
}

/** Every answer the judge will see: each original, then its changes, in a fixed order. */
export function plan(cases: Case[], only?: OperatorId[], excluded: Exclusion[] = []): Item[] {
  const pool = entityPool(cases)
  const items: Item[] = []
  for (const c of cases) {
    items.push({ caseId: c.id, operator: "original", kind: "original", change: "", text: c.answer })
    for (const m of mutate({ answer: c.answer, reference: c.reference, pool, seed: c.id, ...(c.distractors ? { distractors: c.distractors } : {}) })) {
      if (only && !only.includes(m.operator)) continue
      if (excluded.some((x) => x.caseId === c.id && x.operator === m.operator)) continue
      items.push({ caseId: c.id, operator: m.operator, kind: m.kind, change: m.change, text: m.text })
    }
  }
  return items
}

export interface RunOptions {
  repeats: number
  concurrency: number
  cacheDir: string
  onProgress?: (done: number, total: number) => void
  fetchImpl?: typeof fetch
}

/** Put every item in front of the judge `repeats` times, a few calls at a time. */
export async function judgeAll(judge: JudgeConfig, cases: Case[], items: Item[], options: RunOptions): Promise<Judged[]> {
  const byId = new Map(cases.map((c) => [c.id, c]))
  const jobs = items.flatMap((item) => Array.from({ length: options.repeats }, (_, repeat) => ({ item, repeat })))
  const out: Judged[] = new Array(jobs.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, async () => {
      for (let i = next++; i < jobs.length; i = next++) {
        const job = jobs[i]
        if (!job) continue
        const c = byId.get(job.item.caseId)
        if (!c) throw new Error(`no case ${job.item.caseId}`)
        const vars = { ...c.vars, reference: c.reference, answer: job.item.text }
        const call = await callJudge(judge, vars, {
          cacheDir: options.cacheDir,
          repeat: job.repeat,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        })
        out[i] = { ...job.item, repeat: job.repeat, verdict: call.verdict, raw: call.raw }
        done += 1
        options.onProgress?.(done, jobs.length)
      }
    }),
  )
  return out
}
