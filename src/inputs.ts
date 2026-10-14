// Reading what a run is given: cases, exclusions and numeric flags, each checked before any call.
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { KIND } from "./operators.ts"
import { plan } from "./run.ts"
import type { OperatorId } from "./operators.ts"
import type { Case, Exclusion } from "./run.ts"

/** A mistake in what the user passed: exit code 2, never a half-run. */
export class UsageError extends Error {}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === "string")

/** Cases, checked line by line: a malformed case would be graded against the wrong question. */
export async function readCases(path: string, limit?: number): Promise<Case[]> {
  const lines = (await readFile(path, "utf8")).split("\n").filter((l) => l.trim())
  const seen = new Set<string>()
  const cases = lines.map((line, i) => {
    const where = `${path}:${i + 1}`
    let c: Partial<Case>
    try {
      c = JSON.parse(line) as Partial<Case>
    } catch {
      throw new UsageError(`${where}: not valid JSON`)
    }
    if (!c.id || typeof c.id !== "string" || typeof c.answer !== "string" || typeof c.reference !== "string") {
      throw new UsageError(`${where}: each case needs id, answer and reference as strings`)
    }
    if (seen.has(c.id)) throw new UsageError(`${where}: the id "${c.id}" is used twice`)
    seen.add(c.id)
    if (c.vars !== undefined && (typeof c.vars !== "object" || c.vars === null || Array.isArray(c.vars) || !isStrings(Object.values(c.vars)))) {
      throw new UsageError(`${where}: vars must map names to strings`)
    }
    if (c.distractors !== undefined && !isStrings(c.distractors)) throw new UsageError(`${where}: distractors must be a list of strings`)
    if (c.terms !== undefined && !(Array.isArray(c.terms) && c.terms.every((t) => isStrings(t) && t.length === 2))) {
      throw new UsageError(`${where}: terms must be a list of [word, opposite] pairs`)
    }
    return c as Case
  })
  return limit ? cases.slice(0, limit) : cases
}

export function operatorList(value: string | undefined): OperatorId[] | undefined {
  if (!value) return undefined
  const ids = value.split(",").map((s) => s.trim()) as OperatorId[]
  for (const id of ids) if (!(id in KIND)) throw new UsageError(`unknown operator "${id}"; known: ${Object.keys(KIND).join(", ")}`)
  return ids
}

export function wholeNumber(name: string, value: string | undefined, min: number): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} must be a whole number of at least ${min}, not "${value}"`)
  return n
}

export function share(name: string, value: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new UsageError(`--${name} must be a share between 0 and 1 (e.g. 0.1), not "${value}"`)
  return n
}

/** Exclusions are read by hand once; one that no longer matches an answer is stale and must go. */
export async function readExclusions(casesPath: string, cases: Case[], only: OperatorId[] | undefined): Promise<Exclusion[]> {
  const file = join(dirname(casesPath), "excluded.json")
  if (!existsSync(file)) return []
  const excluded = JSON.parse(await readFile(file, "utf8")) as Exclusion[]
  if (!Array.isArray(excluded) || excluded.some((x) => typeof x?.caseId !== "string" || typeof x.operator !== "string" || typeof x.reason !== "string")) {
    throw new UsageError(`${file}: each exclusion needs caseId, operator and reason`)
  }
  const planned = new Set(plan(cases, only).map((i) => `${i.caseId}|${i.operator}`))
  const ids = new Set(cases.map((c) => c.id))
  for (const x of excluded) {
    if (!ids.has(x.caseId) || (only && !only.includes(x.operator))) continue
    if (!planned.has(`${x.caseId}|${x.operator}`)) throw new UsageError(`${file}: ${x.caseId} ${x.operator} matches no answer; remove it`)
  }
  return excluded
}
