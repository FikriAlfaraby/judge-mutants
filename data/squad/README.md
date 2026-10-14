# SQuAD cases

`cases.jsonl` is built from the SQuAD v1.1 development set (Rajpurkar et al., 2016), which is licensed
CC BY-SA 4.0; this derived file carries the same licence. Built by `scripts/squad-cases.py` with a
rule fixed before any judge ran: for each of the first 48 articles, the first question of its first
paragraph; reference = the first gold answer; answer = the context sentence containing that answer,
verbatim (5 cases skipped where the gold answer crosses a sentence boundary).

`distractors` were proposed by GPT-6 Luna (`scripts/distractors.ts`) and read by hand. Every wrong
answer the tool generates was read before any judge ran; `excluded.json` lists the two left out,
with reasons. The code fixes that came out of the same reading (negating only the verb that governs
the fact, unit changes only next to a number, no swaps of clause-length references) are in the git
history before the first run.
