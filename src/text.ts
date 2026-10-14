/** Small text helpers the operators share. English and Indonesian, no dependencies. */

export interface Span {
  start: number
  end: number
  text: string
}

/** Words that end in a period without ending the sentence. A single capital letter counts too ("John F. Kennedy"). */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "mt", "jr", "sr", "no", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "a.m", "p.m", "inc", "ltd", "co", "approx", "jl"])

/**
 * Sentence spans: split after . ! ? (and any closing quote or bracket) followed by a space, or at a
 * line break, keeping each sentence's own text. A period inside a token ("1.5bn", "U.S.", "e.g.")
 * or after an abbreviation does not end a sentence.
 */
export function sentences(text: string): Span[] {
  const out: Span[] = []
  let start = 0
  const cut = (end: number) => {
    const raw = text.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const body = raw.trim()
    if (body) out.push({ start: start + lead, end: start + lead + body.length, text: body })
    start = end
  }
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? ""
    if (c === "\n") {
      cut(i)
      continue
    }
    if (c !== "." && c !== "!" && c !== "?") continue
    let j = i
    while (/[.!?"'’”)\]]/.test(text[j + 1] ?? "")) j += 1
    const next = text[j + 1]
    if (next !== undefined && !/\s/.test(next)) {
      i = j
      continue
    }
    if (c === ".") {
      const word = /[\p{L}.]+$/u.exec(text.slice(start, i))?.[0] ?? ""
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) {
        i = j
        continue
      }
    }
    cut(j + 1)
    i = j
  }
  cut(text.length)
  return out
}

const GREETING = /^(?:hi|hai|halo|hallo|hello|hey|dear|pagi|siang|sore|malam|selamat\s+(?:pagi|siang|sore|malam))\b/i
const SIGN_OFF = /^(?:best|regards|best regards|kind regards|warm regards|thanks|thank you|cheers|salam|hormat saya|terima kasih)\b/i

/** A short greeting ("Hi!", "Halo Kak Rina,") or sign-off ("Best, Amelia"): the frame of a message, not its content. */
export function isGreeting(sentence: string): boolean {
  return sentence.split(/\s+/).length <= 4 && GREETING.test(sentence)
}

export function isSignOff(sentence: string): boolean {
  return sentence.split(/\s+/).length <= 4 && SIGN_OFF.test(sentence)
}

/** A message rather than an answer: it opens with a greeting or closes with a sign-off. */
export function isMessage(text: string): boolean {
  const all = sentences(text)
  const first = all[0]?.text ?? ""
  const last = all[all.length - 1]?.text ?? ""
  return GREETING.test(first) || (all.length > 1 && isSignOff(last))
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
const INDONESIAN = new Set(["yang", "dan", "di", "untuk", "kak", "ya", "tidak", "sudah", "bisa", "saya", "kalau", "kita", "anda", "masih", "dengan", "atau", "kami", "apakah", "kabari", "salam"])

export function isIndonesian(text: string): boolean {
  const hits = new Set((text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => INDONESIAN.has(w)))
  return hits.size >= 2
}

const SCALE: Record<string, number> = {
  miliar: 1e9,
  milyar: 1e9,
  billion: 1e9,
  bn: 1e9,
  juta: 1e6,
  jt: 1e6,
  million: 1e6,
  ribu: 1e3,
  rb: 1e3,
  thousand: 1e3,
}

/**
 * The value a number token writes, reading separators the way Indonesian and English do:
 * "1.500.000" and "1,500,000" are thousands groups; "1,5" and "1.5" are decimals.
 */
export function numberValue(token: string): number {
  if (/^\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(token)) return Number(token.replace(/[.,]/g, ""))
  return Number(token.replace(",", "."))
}

export interface Amount extends Span {
  /** The number times its scale word: "1,5 miliar" -> 1500000000. */
  value: number
}

/** Numbers followed by a scale word ("1,5 miliar", "Rp15 juta", "1.5bn"), with their value. */
export function amounts(text: string): Amount[] {
  const out: Amount[] = []
  const re = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)*)\s?(miliar|milyar|billion|bn|juta|jt|million|ribu|rb|thousand)(?![\p{L}])/giu
  for (const m of text.matchAll(re)) {
    const number = m[1] ?? ""
    const factor = SCALE[(m[2] ?? "").toLowerCase()]
    if (!factor) continue
    const start = m.index ?? 0
    out.push({ start, end: start + number.length, text: number, value: numberValue(number) * factor })
  }
  return out
}
