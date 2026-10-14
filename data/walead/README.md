# wa-lead-extractor drafts

Twelve follow-up messages written by wa-lead-extractor's own writer stage
(`eval/run-message-eval.ts`, 6 conversations x 2 agent voices) with GPT-6 Luna on 14 Oct 2026.
`reference` and `vars.facts` are the project's hand-labelled lead profiles (`eval/golden.json`);
`vars.voice` is the agent's voice profile (`data/agents.json`). `distractors` are the other areas
that appear in the labels. The judge prompt in `judges/walead-grounded.*.json` is the project's
judge prompt (`src/judge.ts`), copied verbatim; only its "grounded" verdict is read.

Run with `--operators number,unit,entity,date,term,reformat,filler`. Negation and drop are left
out on purpose: the verbs these messages could negate are in the question to the lead ("Could we
have a quick call?"), not in a stated fact, and a message that leaves a fact out is still grounded,
which is the only verdict read. Reorder never applies to a message. All 32 wrong answers were read
by hand before the first run; each contradicts one field of the facts, and none was excluded.
