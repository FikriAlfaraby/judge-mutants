# judge-mutants

**How often does your LLM judge pass a wrong answer, or fail a right one?**

Most teams grade LLM output with another LLM: a rubric, a factuality check, a "does this match the
reference" prompt. Few measure the grader itself. judge-mutants does, the way mutation testing
measures a test suite: it takes answers you know are correct, breaks each one in a single, known
way, and asks your judge again.

- **Wrong answers** (the judge must fail them): a number moved (`30 -> 40`, `1,5 miliar -> 1,6
  miliar`), a name swapped for one of the same kind (`Denver Broncos -> Pittsburgh Steelers`), a
  unit swapped (`juta -> miliar`), a date shifted, the verb that states the fact negated, the key
  sentence dropped.
- **Controls** (the judge must still pass them): the same answer as a list, with a label in front,
  or with a harmless sentence at the end.

It reports, per kind of change, how many wrong answers the judge passed and how many controls it
failed, with the judge's own reasons. Exit code 1 above a threshold, so it can gate CI when someone
edits a judge prompt.

```bash
judge-mutants plan --cases cases.jsonl              # what will be asked, no model calls
JM_KEY=... judge-mutants run --cases cases.jsonl --judge judges/strict.luna.json --out runs/x
```

A case is one line of JSON: `{"id", "answer", "reference", "vars": {...}, "distractors": [...]}`.
A judge is a JSON file: endpoint and model (any OpenAI-compatible API), the prompt with
`{{answer}}`, `{{reference}}` and your own slots, and how to read the verdict (a JSON path, a score
threshold, or a pair of regular expressions). Replies the reading rule cannot parse are counted as
unreadable, never guessed.

## Method, and why the numbers can be trusted

- A change counts only for cases where the judge passed the untouched answer: failing a wrong
  answer proves nothing if the judge also fails the right one.
- Every wrong answer was read by hand before any judge ran. Where a change did not touch the fact
  the question asks about, the operator was fixed, or the change was excluded with a written
  reason (`data/*/excluded.json`). The dataset, the exclusions and the judge prompts were committed
  and tagged (`v0.1-before-runs`) before the first full run.
- Judge prompts are copied verbatim from the tools teams use (promptfoo's `llm-rubric` and
  `factuality`, OpenAI's closed-QA prompt as shipped in promptfoo; MIT), plus one strict prompt of
  my own for comparison.
- Every reply is cached with its request, so a run can be re-read and re-scored without paying for
  it twice.

Results: see `docs/results.md` (written after the runs) and
[fikrialfaraby.com/judges](https://fikrialfaraby.com/judges/).

## Related work

Perturbation-based meta-evaluation of LLM judges is an active research area: Eval-Pair Matrix
(entity substitution, numerical shift, negation on grounded RAG), RAND's judge-reliability harness,
the FBI benchmark, and "Judging Against the Reference" (entity swaps in QA judging). muteval
mutates the system under test rather than the judge's answers. judge-mutants is the practical
version for a product team: your judge prompt, your model, your cases, a CI exit code.

## Part of a series

- [oracle-mutants](https://github.com/FikriAlfaraby/oracle-mutants): the same idea for AI
  benchmark graders; it found a Terminal-Bench grader that gives full marks to a wrong program.
- [mutant-lab](https://github.com/FikriAlfaraby/mutant-lab): mutation testing in the browser.

## How this was made

I build with an AI coding agent (Claude Code) doing much of the typing. I direct it, review the
results, and answer for them. MIT licence. SQuAD-derived data is CC BY-SA 4.0 (see
`data/squad/README.md`). Fikri Alfaraby, [fikrialfaraby.com](https://fikrialfaraby.com)
