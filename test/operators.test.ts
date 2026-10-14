import assert from "node:assert/strict"
import { test } from "node:test"

import { mutate } from "../src/operators.ts"
import type { Mutation, MutateInput } from "../src/operators.ts"
import { bumpNumber, entities, numbers, sentences } from "../src/text.ts"

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
