import { bumpNumber, digitsOf, entities, isIndonesian, numbers, sentences, splice, words } from "./text.ts"
import type { Span } from "./text.ts"

/** Wrong answers a judge must fail, and controls (same meaning, new form) it must still pass. */
export type OperatorId = "number" | "negation" | "entity" | "unit" | "date" | "drop" | "reformat" | "filler" | "reorder"
export type OperatorKind = "wrong" | "control"

export const KIND: Record<OperatorId, OperatorKind> = {
  number: "wrong",
  negation: "wrong",
  entity: "wrong",
  unit: "wrong",
  date: "wrong",
  drop: "wrong",
  reformat: "control",
  filler: "control",
  reorder: "control",
}

export interface Mutation {
  operator: OperatorId
  kind: OperatorKind
  /** The answer with the change applied. */
  text: string
  /** What changed, for the report: "35 -> 36", "removed: ...". */
  change: string
}

export interface MutateInput {
  /** A correct answer. */
  answer: string
  /** What the answer must agree with; a wrong change is only made to something it mentions. */
  reference: string
  /** Proper nouns from the whole dataset, for swaps when the case gives no distractors. */
  pool: string[]
  /** Values of the same kind as the reference (other answers about the same text), preferred for swaps. */
  distractors?: string[]
  /** Makes every choice repeatable (the case id). */
  seed: string
}

/** Every applicable mutation of one answer, in a fixed operator order. */
export function mutate(input: MutateInput): Mutation[] {
  const out: Mutation[] = []
  for (const op of OPERATORS) {
    const m = op(input)
    if (m && m.text !== input.answer && m.text.trim() !== "") out.push(m)
  }
  return out
}

type Operator = (input: MutateInput) => Mutation | null

const YEAR = /^(1[5-9]\d\d|20\d\d)$/

/** A number the reference also states: 30 -> 40, 1.500.000 -> 1.600.000. Years are left to `date`. */
function wrongNumber({ answer, reference }: MutateInput): Mutation | null {
  const wanted = new Set(numbers(reference).map((n) => digitsOf(n.text)))
  const target = numbers(answer).find((n) => wanted.has(digitsOf(n.text)) && !YEAR.test(n.text))
  if (!target) return null
  let replacement = bumpNumber(target.text)
  // Never bump onto another true value from the reference.
  for (let i = 0; i < 5 && wanted.has(digitsOf(replacement)); i += 1) replacement = bumpNumber(replacement)
  const text = replaceAllToken(answer, target.text, replacement)
  return { operator: "number", kind: "wrong", text, change: `${target.text} -> ${replacement}` }
}

const EN_REMOVE: [RegExp, string][] = [
  [/\bcannot\b/i, "can"],
  [/\bcan't\b/i, "can"],
  [/\bwon't\b/i, "will"],
  [/\b(is|are|was|were|does|do|did|has|have|had|should|could|would|must)n't\b/i, "$1"],
  [/\b(is|are|was|were|does|do|did|has|have|had|should|could|would|must|can|will) not\b/i, "$1"],
  [/\bnever\b/i, "always"],
]
const EN_INSERT = /\b(is|are|was|were|can|will|does|do|did|has|have|had|should|must|could|would)\b/i
const ID_REMOVE: [RegExp, string][] = [
  [/\bsudah tidak\b/i, "masih"],
  [/\btidak\s+/i, ""],
  [/\bbukan\s+/i, ""],
  [/\bbelum\b/i, "sudah"],
]
const ID_INSERT: [RegExp, string][] = [
  [/\bmasih ada\b/i, "sudah tidak ada"],
  [/\bsudah\b/i, "belum"],
  [/\b(bisa|ada|mau|perlu|akan|boleh)\b/i, "tidak $1"],
]

/**
 * A sentence that carries the reference's facts says the opposite: "is" -> "is not",
 * "tidak bisa" -> "bisa", "masih ada" -> "sudah tidak ada". Sentences are tried from the most
 * relevant down, so a key sentence without a verb to negate does not end the search.
 */
function negation({ answer, reference }: MutateInput): Mutation | null {
  const rules = isIndonesian(answer) ? [...ID_REMOVE, ...ID_INSERT] : [...EN_REMOVE, [EN_INSERT, "$1 not"] as [RegExp, string]]
  const lower = answer.toLowerCase()
  const fact = reference.toLowerCase().replace(/[.,;]+$/, "").trim()
  if (fact && lower.includes(fact)) {
    // The answer states the fact word for word: negate only the verb that governs it, either just
    // before it in the same clause ("was the first recipient of the Nobel Prize") or just after it
    // when the fact is the subject ("Computational complexity theory is a branch ..."). A comma,
    // bracket or relative pronoun in between means another clause, so nothing is negated.
    for (let at = lower.indexOf(fact); at >= 0; at = lower.indexOf(fact, at + 1)) {
      const before = answer.slice(Math.max(0, at - 80), at)
      const clause = before.split(/[,;:()\[\]]|\b(?:who|which|that|whose|where|yang)\b/i).pop() ?? ""
      const clauseStart = at - clause.length
      for (const [re, to] of rules) {
        const all = [...clause.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))]
        const m = all[all.length - 1]
        if (!m || m.index === undefined || clause.slice(m.index).split(/\s+/).length > 9) continue
        const start = clauseStart + m.index
        const fixed = m[0].replace(re, to)
        return { operator: "negation", kind: "wrong", text: splice(answer, { start, end: start + m[0].length }, fixed), change: `${m[0]} -> ${fixed}` }
      }
      const after = /^\s*(\S+\s+){0,1}?/.exec(answer.slice(at + fact.length))
      const tail = answer.slice(at + fact.length, at + fact.length + 40)
      if (after && !/^\s*[,;:()\[\]]/.test(tail)) {
        for (const [re, to] of rules) {
          const m = re.exec(tail)
          if (!m || m.index > 12) continue
          const start = at + fact.length + m.index
          const fixed = m[0].replace(re, to)
          return { operator: "negation", kind: "wrong", text: splice(answer, { start, end: start + m[0].length }, fixed), change: `${m[0]} -> ${fixed}` }
        }
      }
    }
    return null
  }
  // The reference is not quoted (structured facts, a paraphrase): try the most relevant sentences.
  for (const sentence of byRelevance(answer, reference)) {
    for (const [re, to] of rules) {
      const m = re.exec(sentence.text)
      if (!m) continue
      const fixed = m[0].replace(re, to)
      const at = sentence.start + m.index
      return { operator: "negation", kind: "wrong", text: splice(answer, { start: at, end: at + m[0].length }, fixed), change: `${m[0]} -> ${fixed}` }
    }
  }
  return null
}

/**
 * A name the reference mentions, swapped for another of the same kind: Denver Broncos -> Carolina
 * Panthers, BSD -> Kemang. The case's own distractors come first (they are the same kind of thing);
 * the dataset pool is the fallback, and among candidates the closest word count wins.
 */
function swapEntity({ answer, reference, pool, distractors, seed }: MutateInput): Mutation | null {
  const ref = reference.toLowerCase().replace(/[.,;]+$/, "").trim()
  if (!/\p{L}/u.test(ref)) return null // a bare number or year: the number and date operators own it
  if (ref.split(/\s+/).length > 5) return null // a clause, not a name: swapping it reads as garbage
  const quoted = answer.toLowerCase().indexOf(ref)
  const target =
    quoted >= 0 && /^\p{Lu}/u.test(answer.slice(quoted))
      ? { start: quoted, end: quoted + ref.length, text: answer.slice(quoted, quoted + ref.length) }
      : entities(answer).find((e) => ref.includes(e.text.toLowerCase()) || e.text.toLowerCase().includes(ref))
  if (!target) return null
  const taken = `${answer} ${reference}`.toLowerCase()
  const fits = (p: string) => p !== target.text && /^[A-Z0-9]/.test(p) && !taken.includes(p.toLowerCase()) && !ref.includes(p.toLowerCase())
  const width = (p: string) => Math.abs(p.split(/\s+/).length - target.text.split(/\s+/).length)
  // A case that brings its own distractors never falls back to the pool: a name of the wrong kind
  // ("France -> Eisenhower's") would be an easy catch and flatter the judge.
  for (const source of distractors && distractors.length > 0 ? [distractors] : [pool]) {
    const options = source.filter(fits)
    if (options.length === 0) continue
    const best = Math.min(...options.map(width))
    const closest = options.filter((p) => width(p) === best)
    const replacement = closest[hash(seed + target.text) % closest.length] ?? closest[0] ?? ""
    return { operator: "entity", kind: "wrong", text: replaceAllToken(answer, target.text, replacement), change: `${target.text} -> ${replacement}` }
  }
  return null
}

const UNITS: [string, string][] = [
  ["kilometers", "miles"],
  ["kilometres", "miles"],
  ["km", "mi"],
  ["meters", "feet"],
  ["metres", "feet"],
  ["kilograms", "pounds"],
  ["kg", "lb"],
  ["celsius", "fahrenheit"],
  ["hours", "minutes"],
  ["minutes", "seconds"],
  ["days", "weeks"],
  ["weeks", "months"],
  ["months", "years"],
  ["million", "billion"],
  ["billion", "trillion"],
  ["dollars", "euros"],
  ["USD", "EUR"],
  ["juta", "miliar"],
  ["miliar", "triliun"],
  ["ribu", "juta"],
  ["rb", "jt"],
  ["jam", "menit"],
  ["hari", "minggu"],
  ["minggu", "bulan"],
  ["bulan", "tahun"],
]

/** A unit the answer states, swapped for a different one: juta -> miliar, km -> mi. */
function wrongUnit({ answer }: MutateInput): Mutation | null {
  let best: { at: number; from: string; to: string } | null = null
  for (const [a, b] of UNITS) {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      // Only a unit that measures a number ("1,5 miliar", "10 km"), never a word like "Seven Years' War".
      const m = new RegExp(`(?<=\\d[\\d.,]*\\s?)${from}(?![\\p{L}'’])`, "iu").exec(answer)
      if (m && (!best || m.index < best.at)) best = { at: m.index, from: m[0], to: matchCase(m[0], to) }
    }
  }
  if (!best) return null
  return {
    operator: "unit",
    kind: "wrong",
    text: splice(answer, { start: best.at, end: best.at + best.from.length }, best.to),
    change: `${best.from} -> ${best.to}`,
  }
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
const DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const DAYS_ID = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]

/** A year, month or weekday the reference states, moved by one: 1918 -> 1919, May -> June. */
function shiftDate({ answer, reference }: MutateInput): Mutation | null {
  const ref = reference.toLowerCase()
  for (const n of numbers(answer)) {
    if (YEAR.test(n.text) && ref.includes(n.text)) {
      const to = String(Number(n.text) + 1)
      return { operator: "date", kind: "wrong", text: replaceAllToken(answer, n.text, to), change: `${n.text} -> ${to}` }
    }
  }
  for (const list of [MONTHS_EN, MONTHS_ID, DAYS_EN, DAYS_ID]) {
    for (const [i, name] of list.entries()) {
      const m = new RegExp(`\\b${name}\\b`).exec(answer)
      if (m && ref.includes(name.toLowerCase())) {
        const to = list[(i + 1) % list.length] ?? name
        return { operator: "date", kind: "wrong", text: replaceAllToken(answer, name, to), change: `${name} -> ${to}` }
      }
    }
  }
  return null
}

/** The sentence that carries the reference's facts is removed; the rest stays. */
function dropKey({ answer, reference }: MutateInput): Mutation | null {
  const all = sentences(answer)
  if (all.length < 2) return null
  const key = keySentence(answer, reference)
  if (!key) return null
  const lost = [...words(key.text)].filter((w) => words(reference).has(w))
  const rest = all.filter((s) => s.start !== key.start).map((s) => s.text).join(" ")
  if (lost.length === 0 || lost.every((w) => words(rest).has(w))) return null
  return { operator: "drop", kind: "wrong", text: rest, change: `removed: ${key.text}` }
}

/** Same words as a list, or with a label in front. */
function reformat({ answer }: MutateInput): Mutation | null {
  const all = sentences(answer)
  if (all.length >= 2) {
    return { operator: "reformat", kind: "control", text: all.map((s) => `- ${s.text}`).join("\n"), change: "as a bulleted list" }
  }
  const label = isIndonesian(answer) ? "Jawaban: " : "Answer: "
  return { operator: "reformat", kind: "control", text: `${label}${answer.trim()}`, change: `prefixed "${label.trim()}"` }
}

/** A harmless sentence at the end. A judge that fails this is grading length or tone, not facts. */
function filler({ answer }: MutateInput): Mutation | null {
  const extra = isIndonesian(answer) ? "Semoga membantu ya." : "I hope this helps."
  return { operator: "filler", kind: "control", text: `${answer.trimEnd()} ${extra}`, change: `added: ${extra}` }
}

const CONNECTOR = /^(also|this|it|they|he|she|then|so|therefore|which|however|but|and|ini|itu|lalu|jadi|tapi|dan|dia|mereka)\b/i

/** The first two sentences swap places, when neither leans on the other. */
function reorder({ answer }: MutateInput): Mutation | null {
  const all = sentences(answer)
  if (all.length < 2) return null
  const [a, b] = all
  if (!a || !b || CONNECTOR.test(b.text) || CONNECTOR.test(a.text)) return null
  const text = `${answer.slice(0, a.start)}${b.text} ${a.text}${answer.slice(b.end)}`
  return { operator: "reorder", kind: "control", text, change: "first two sentences swapped" }
}

const OPERATORS: Operator[] = [wrongNumber, negation, swapEntity, wrongUnit, shiftDate, dropKey, reformat, filler, reorder]

/** Sentences that share at least one word with the reference, most shared words first. */
function byRelevance(answer: string, reference: string): Span[] {
  const ref = words(reference)
  return sentences(answer)
    .map((s) => ({ s, score: [...words(s.text)].filter((w) => ref.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.start - b.s.start)
    .map((x) => x.s)
}

/** The sentence sharing the most words with the reference. */
function keySentence(answer: string, reference: string): Span | null {
  return byRelevance(answer, reference)[0] ?? null
}

/** Replace every whole-token occurrence (not inside a longer word or number). */
function replaceAllToken(text: string, token: string, to: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Unicode-aware edges: "Amazon" must not match inside "Amazonía".
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_.,])${escaped}(?![\\p{L}\\p{N}_]|[.,]\\p{N})`, "gu"), to)
}

function matchCase(original: string, to: string): string {
  if (original === original.toUpperCase() && original.length > 1) return to.toUpperCase()
  if (original[0] === original[0]?.toUpperCase()) return to[0]?.toUpperCase() + to.slice(1)
  return to
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
