/** Small text helpers the operators share. English and Indonesian, no dependencies. */

export interface Span {
  start: number
  end: number
  text: string
}

/** Sentence spans: split after . ! ? or a line break, keeping each sentence's own text. */
export function sentences(text: string): Span[] {
  const out: Span[] = []
  const re = /[^.!?\n]+(?:[.!?]+(?=\s|$)|$)|[^\n]+/g
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const body = raw.trim()
    if (body) out.push({ start: (m.index ?? 0) + lead, end: (m.index ?? 0) + lead + body.length, text: body })
  }
  return out
}

/**
 * Number tokens, with their thousands separators and decimals as written:
 * "1.500.000", "1,500", "2.5", "30", "1,1". A digit inside a word (e.g. "B2B") is not a number.
 */
export function numbers(text: string): Span[] {
  const out: Span[] = []
  const re = /(?<![\w.,])\d{1,3}(?:([.,])\d{3}(?:\1\d{3})*)?(?:[.,]\d+)?(?![\w])|(?<![\w.,])\d+(?:[.,]\d+)?(?![\w])/g
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[.,]$/, "")
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + raw.length, text: raw })
  }
  return out
}

/** The digits of a number token, ignoring separators: "1.500.000" and "1500000" share "1500000". */
export function digitsOf(token: string): string {
  return token.replace(/[^\d]/g, "")
}

/**
 * A nearby wrong value: the last non-zero digit goes up by one, carrying as needed, separators
 * kept. 30 -> 40, 35 -> 36, 1.500.000 -> 1.600.000, 2.5 -> 2.6, 19 -> 20, 0 -> 1.
 */
export function bumpNumber(token: string): string {
  const chars = [...token]
  let i = chars.length - 1
  while (i >= 0 && (chars[i] === "0" || !/\d/.test(chars[i] ?? ""))) i -= 1
  if (i < 0) {
    // All zeros: make the last digit 1.
    const last = chars.map((c, k) => (/\d/.test(c) ? k : -1)).filter((k) => k >= 0).pop()
    if (last === undefined) return token
    chars[last] = "1"
    return chars.join("")
  }
  for (; i >= 0; i -= 1) {
    const c = chars[i] ?? ""
    if (!/\d/.test(c)) continue
    if (c !== "9") {
      chars[i] = String(Number(c) + 1)
      return chars.join("")
    }
    chars[i] = "0"
  }
  return `1${chars.join("")}`
}

const NOT_ENTITY = new Set([
  "I", "The", "A", "An", "This", "That", "These", "Those", "It", "In", "On", "At", "For", "And", "But", "Or", "If",
  "When", "What", "Which", "Who", "How", "Why", "Yes", "No", "Hi", "Hello", "Halo", "Kak", "Pak", "Bu", "Ya",
  "Sure", "Thanks", "Terima", "Kasih", "Untuk", "Dan", "Di", "Ke", "Dari", "Yang", "Saya", "Kami", "Ini", "Itu",
  "They", "He", "She", "We", "You", "Their", "His", "Her", "Its", "Our", "Your", "There", "Here", "Kakak", "Dia", "Mereka",
])

/**
 * Proper-noun phrases: runs of capitalised words not at the start of a sentence, or anywhere when
 * they are not common words ("Kemang", "District 9", "Alam Sutera").
 */
export function entities(text: string): Span[] {
  const out: Span[] = []
  const re = /\b[A-Z][\p{L}'’-]*(?:\s+(?:[A-Z][\p{L}'’-]*|\d+))*/gu
  for (const m of text.matchAll(re)) {
    // Keep the separators so offsets stay exact while common leading words are dropped.
    const parts = m[0].split(/(\s+)/)
    let offset = 0
    let i = 0
    while (i < parts.length && (NOT_ENTITY.has(parts[i] ?? "") || /^\s+$/.test(parts[i] ?? ""))) {
      offset += (parts[i] ?? "").length
      i += 1
    }
    const phrase = parts.slice(i).join("").trimEnd()
    if (!phrase || /^\d+$/.test(phrase)) continue
    const start = (m.index ?? 0) + offset
    out.push({ start, end: start + phrase.length, text: phrase })
  }
  return out
}

/** Lower-case word tokens of three letters or more, for overlap between an answer and a reference. */
export function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))
}

const STOP = new Set(["the", "and", "for", "that", "with", "this", "was", "are", "were", "yang", "dan", "untuk", "dengan", "ini", "itu"])

/** Replace one span. */
export function splice(text: string, span: Pick<Span, "start" | "end">, insert: string): string {
  return text.slice(0, span.start) + insert + text.slice(span.end)
}

/** A rough language guess, enough to pick Indonesian or English filler and negation words. */
export function isIndonesian(text: string): boolean {
  const t = ` ${text.toLowerCase()} `
  const hits = [" yang ", " dan ", " di ", " untuk ", " kak ", " ya ", " tidak ", " sudah ", " bisa ", " saya "].filter((w) => t.includes(w))
  return hits.length >= 2
}
