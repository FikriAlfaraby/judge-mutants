import assert from "node:assert/strict"
import { test } from "node:test"

import { mutate } from "../src/operators.ts"
import type { Mutation, MutateInput } from "../src/operators.ts"
import { bumpNumber, entities, isIndonesian, numbers, sentences } from "../src/text.ts"

const run = (input: MutateInput) => Object.fromEntries(mutate(input).map((m) => [m.operator, m])) as Record<string, Mutation | undefined>

test("numbers keep their separators, and bumping moves the last non-zero digit", () => {
  assert.deepEqual(
    numbers("Budget Rp 1.500.000.000, about 1,5 miliar, 30 units, 2.5 km, B2B").map((n) => n.text),
    ["1.500.000.000", "1,5", "30", "2.5"],
  )
  assert.equal(bumpNumber("30"), "40")
  assert.equal(bumpNumber("35"), "36")
  assert.equal(bumpNumber("19"), "20")
  assert.equal(bumpNumber("1.500.000"), "1.600.000")
  assert.equal(bumpNumber("2.5"), "2.6")
  assert.equal(bumpNumber("0"), "1")
  assert.equal(bumpNumber("99"), "100")
})

test("sentences and proper nouns keep exact offsets; pronouns are not names", () => {
  const text = "The Normans were in Normandy. They came from Denmark, Iceland and Norway!"
  for (const s of sentences(text)) assert.equal(text.slice(s.start, s.end), s.text)
  const found = entities(text)
  assert.deepEqual(found.map((e) => e.text), ["Normans", "Normandy", "Denmark", "Iceland", "Norway"])
  for (const e of found) assert.equal(text.slice(e.start, e.end), e.text)
})

const NORMANS = "The Normans gave their name to Normandy in the 10th century. They settled there in 911 under Rollo."

test("an English answer: number, place, dropped key sentence, and the controls", () => {
  const m = run({ answer: NORMANS, reference: "Normandy, in 911", pool: ["Brittany", "Aquitaine", "Rollo"], seed: "q1" })
  assert.equal(m.number?.change, "911 -> 912")
  assert.equal(m.entity?.change, "Normandy -> Aquitaine")
  assert.equal(m.drop?.text, "They settled there in 911 under Rollo.")
  assert.equal(m.negation, undefined, "no auxiliary verb to negate, so no negation is forced")
  assert.equal(m.reorder, undefined, "the second sentence starts with They, so the order matters")
  assert.equal(m.reformat?.text, "- The Normans gave their name to Normandy in the 10th century.\n- They settled there in 911 under Rollo.")
  assert.equal(m.filler?.text, `${NORMANS} I hope this helps.`)
})

test("negation hits the verb that governs the quoted fact, and nothing in another clause", () => {
  const m = run({ answer: "The bridge is open to traffic. It was built in 1932.", reference: "open to traffic", pool: [], seed: "b" })
  assert.equal(m.negation?.text, "The bridge is not open to traffic. It was built in 1932.")
  const back = run({ answer: "The museum isn't free on Mondays.", reference: "free on Mondays", pool: [], seed: "m" })
  assert.equal(back.negation?.text, "The museum is free on Mondays.")
  const subject = run({ answer: "Computational complexity theory is a branch of computer science.", reference: "Computational complexity theory", pool: [], seed: "s" })
  assert.equal(subject.negation?.change, "is -> is not")
  const otherClause = run({
    answer: "The Normans were the people who gave their name to Normandy, a region in France.",
    reference: "France",
    pool: [],
    seed: "n",
  })
  assert.equal(otherClause.negation, undefined, "'were' governs 'the people', not 'France'")
})

const MESSAGE = "Halo Kak Rina, untuk rumah di BSD dengan budget 1,5 miliar kami masih ada beberapa pilihan. Kakak bisa survey hari Sabtu ini?"
const FACTS = '{"budgetIDR":1500000000,"areas":["BSD"],"intent":"buy","propertyType":"rumah"}'

test("an Indonesian sales message: area, unit and a natural negation", () => {
  const m = run({ answer: MESSAGE, reference: FACTS, pool: ["Kemang", "Bintaro", "BSD"], seed: "c01" })
  assert.equal(m.entity?.change, "BSD -> Kemang")
  assert.equal(m.entity?.text.includes("BSD"), false)
  assert.equal(m.unit?.change, "miliar -> juta")
  assert.equal(m.negation?.change, "masih ada -> sudah tidak ada")
  assert.equal(m.filler?.text.endsWith("Semoga membantu ya."), true)
})

test("a wrong number never lands on another true value, and replaces every copy", () => {
  const m = run({ answer: "It costs 30 dollars, yes 30, not 40.", reference: "30 or 40 dollars", pool: [], seed: "x" })
  assert.equal(m.number?.change, "30 -> 50")
  assert.equal(m.number?.text, "It costs 50 dollars, yes 50, not 40.")
})

test("nothing is changed that the reference does not mention", () => {
  const m = run({ answer: "Paris is lovely in 2019.", reference: "London", pool: ["Rome"], seed: "z" })
  assert.equal(m.number, undefined)
  assert.equal(m.entity, undefined)
  assert.equal(m.date, undefined)
  assert.equal(m.negation, undefined)
})

test("years, months and weekdays the reference states move by one", () => {
  const m = run({ answer: "The treaty was signed in May 1919.", reference: "signed in 1919", pool: [], seed: "t" })
  assert.equal(m.date?.change, "1919 -> 1920")
  const day = run({ answer: "Survey hari Sabtu ya kak, bisa?", reference: "Sabtu", pool: [], seed: "d" })
  assert.equal(day.date?.change, "Sabtu -> Minggu")
})

test("mutations are repeatable", () => {
  const input = { answer: MESSAGE, reference: FACTS, pool: ["Kemang", "Bintaro", "Alam Sutera"], seed: "c01" }
  assert.deepEqual(mutate(input), mutate(input))
})

test("a long reference is a clause, not a name, so it is never swapped", () => {
  const m = run({
    answer: "Paul Baran developed message block switching at RAND.",
    reference: "Paul Baran developed the concept of message block switching",
    pool: [],
    distractors: ["Ethernet", "the World Wide Web"],
    seed: "p",
  })
  assert.equal(m.entity, undefined)
})

test("names are replaced as whole words, accents included", () => {
  const m = run({ answer: "The Amazon (Spanish: Amazonía) is vast.", reference: "Amazon", pool: [], distractors: ["Congo"], seed: "a" })
  assert.equal(m.entity?.text, "The Congo (Spanish: Amazonía) is vast.")
})

test("a unit changes only where it measures a number", () => {
  assert.equal(run({ answer: "The Seven Years' War ended.", reference: "war", pool: [], seed: "u" }).unit, undefined)
  assert.equal(run({ answer: "Budget 1,5 miliar.", reference: "1,5 miliar", pool: [], seed: "u" }).unit?.change, "miliar -> juta")
})

test("amounts in another notation are still the same fact", () => {
  const facts = '{"budgetIDR": 1500000000, "timeline": "bulan ini"}'
  const id = run({ answer: "Budget 1,5 miliar IDR, target beli bulan ini.", reference: facts, pool: [], seed: "a" })
  assert.equal(id.number?.change, "1,5 -> 1,6")
  assert.equal(id.date?.change, "bulan ini -> bulan depan")
  const en = run({ answer: "Budget of IDR 15,000,000, this week.", reference: '{"budgetIDR": 15000000, "timeline": "minggu ini"}', pool: [], seed: "b" })
  assert.equal(en.number?.change, "15,000,000 -> 16,000,000")
  assert.equal(en.date?.change, "this week -> next week", "the English draft of an Indonesian timeline")
  const noTime = run({ answer: "Budget of IDR 15,000,000, this week.", reference: '{"budgetIDR": 15000000}', pool: [], seed: "b" })
  assert.equal(noTime.date, undefined, "a time the reference never states is not a fact to change")
})

test("domain terms flip only through the case's own list", () => {
  const terms: [string, string][] = [["buy", "rent"], ["1BR", "2BR"]]
  const m = run({ answer: "Still looking to rent a 1BR in BSD?", reference: "{}", pool: [], seed: "t", terms })
  assert.equal(m.term?.change, "rent -> buy")
  assert.equal(run({ answer: "Still looking to rent a 1BR?", reference: "{}", pool: [], seed: "t" }).term, undefined)
})

test("a period inside a number or an abbreviation does not end a sentence", () => {
  const text = 'A budget of IDR 1.5bn, e.g. in BSD. The U.S. Army said "yes." Then it left.'
  assert.deepEqual(sentences(text).map((s) => s.text), ["A budget of IDR 1.5bn, e.g. in BSD.", 'The U.S. Army said "yes."', "Then it left."])
})

test("an amount glued to its scale word moves in place", () => {
  const m = run({ answer: "Budget of IDR 1.5bn, this month.", reference: '{"budgetIDR": 1500000000}', pool: [], seed: "g" })
  assert.equal(m.number?.text, "Budget of IDR 1.6bn, this month.")
})

const FOLLOW_UP = "Hi! Are you still looking to rent in BSD? No worries if plans changed. Best, Amelia"

test("a message keeps its greeting, order and sign-off in every control", () => {
  const m = run({ answer: FOLLOW_UP, reference: '{"areas": ["BSD"]}', pool: [], seed: "f" })
  assert.equal(m.reorder, undefined, "a message is never reordered")
  assert.equal(m.filler?.text, "Hi! Are you still looking to rent in BSD? No worries if plans changed. Thank you. Best, Amelia")
  assert.equal(m.reformat?.text, "Hi!\n- Are you still looking to rent in BSD?\n- No worries if plans changed.\nBest, Amelia")
  const one = run({ answer: "Hai, masih cari rumah di BSD untuk dibeli? Salam, Budi", reference: "{}", pool: [], seed: "o" })
  assert.equal(one.reformat?.text, "Hai, masih cari rumah di BSD untuk dibeli?\n\nSalam, Budi")
  assert.equal(one.filler?.change, "added: Terima kasih ya.")
})

test("Indonesian is recognised from common words, punctuation or not", () => {
  assert.equal(isIndonesian("Bagaimana kalau kita jadwalkan obrolan singkat untuk membahas kebutuhan properti Anda? Salam, Budi"), true)
  assert.equal(isIndonesian("Dan Brown wrote it in the U.S."), false)
})

test("negation stays in the fact's own sentence and never matches inside a longer word", () => {
  const ankara = run({ answer: "The museum was founded in 1990. Ankara is the capital of Turkey.", reference: "Ankara", pool: [], seed: "n1" })
  assert.equal(ankara.negation?.text, "The museum was founded in 1990. Ankara is not the capital of Turkey.")
  const rome = run({ answer: "Romeo is a play, and Rome is the capital of Italy.", reference: "Rome", pool: [], seed: "n2" })
  assert.equal(rome.negation?.text, "Romeo is a play, and Rome is not the capital of Italy.")
})

test("a name is matched against the reference's values, never its JSON keys", () => {
  const m = run({ answer: "Are you still looking to rent in BSD?", reference: '{"areas": ["BSD"], "intent": "rent"}', pool: [], distractors: ["Kemang"], seed: "e" })
  assert.equal(m.entity?.text, "Are you still looking to rent in Kemang?")
})

test("numbers are matched by value, not by their digits", () => {
  const m = run({ answer: "The 15 files take 1.5 MB.", reference: "1.5", pool: [], seed: "v" })
  assert.equal(m.number?.text, "The 15 files take 1.6 MB.")
})

test("a unit changes only where its number is a value the reference states", () => {
  assert.equal(run({ answer: "The 5 km road opened in Paris.", reference: "Paris", pool: [], seed: "u" }).unit, undefined)
  assert.equal(run({ answer: "The road is 5 km long.", reference: "5 km", pool: [], seed: "u" }).unit?.change, "km -> mi")
})

test("every copy of a changed amount moves, so no true copy is left behind", () => {
  const m = run({ answer: "Budget 1,5 miliar, ya, 1,5 miliar.", reference: '{"budgetIDR": 1500000000}', pool: [], seed: "c" })
  assert.equal(m.number?.text, "Budget 1,6 miliar, ya, 1,6 miliar.")
})

test("the harmless sentence is never glued onto an answer without an ending", () => {
  assert.equal(run({ answer: "30", reference: "30", pool: [], seed: "f" }).filler?.text, "30. I hope this helps.")
})
