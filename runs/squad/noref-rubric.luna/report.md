# judge-mutants: noref-rubric.luna

43 cases. The judge passed 40 of 43 correct answers. Changes are counted only where it passed the original.

| Change | Kind | Judged | Passed | Rate | Unreadable |
|---|---|---:|---:|---:|---:|
| date | wrong (should fail) | 3 | 2 | 66.7% | 0 |
| number | wrong (should fail) | 2 | 1 | 50% | 0 |
| entity | wrong (should fail) | 18 | 4 | 22.2% | 0 |
| negation | wrong (should fail) | 13 | 0 | 0% | 0 |
| reformat | control (should pass) | 40 | 40 | 100% | 0 |
| filler | control (should pass) | 40 | 40 | 100% | 0 |

## Wrong answers the judge passed

- **date** (squad-56df9e28): 1856 -> 1857. Judge: "The output states that Nikola Tesla was born on 10 July 1857, so the year is 1857."
- **date** (squad-5733cf61): 1754 -> 1755. Judge: "The output states that the French and Indian War took place from 1755 to 1763."
- **number** (squad-5727e6cb): 40 -> 50. Judge: "The output states that the richest 1% owned 50% of global assets."
- **entity** (squad-56e16182): Computational complexity theory -> Computability theory. Judge: "The output identifies computability theory as the branch concerned with classifying computational problems by difficulty and relating the resulting classes."
- **entity** (squad-57273a46): Construction -> Engineering. Judge: "The output directly identifies engineering as the process of constructing a building or infrastructure."
- **entity** (squad-5727aa41): John Harvard -> Increase Mather. Judge: "The output states that Harvard was named for Increase Mather, directly answering the question."
