# judge-mutants: noref-rubric.luna

43 cases. The judge passed 122 of 129 correct answers. Changes are counted only where it passed the original.

| Change | Kind | Judged | Passed | Rate | Unreadable |
|---|---|---:|---:|---:|---:|
| date | wrong (should fail) | 9 | 5 | 55.6% | 0 |
| number | wrong (should fail) | 6 | 2 | 33.3% | 0 |
| entity | wrong (should fail) | 54 | 9 | 16.7% | 0 |
| negation | wrong (should fail) | 40 | 1 | 2.5% | 0 |
| reformat | control (should pass) | 122 | 121 | 99.2% | 0 |
| filler | control (should pass) | 122 | 120 | 98.4% | 0 |

Verdicts that changed between repeats: 5.4% of items.

## Wrong answers the judge passed

- **date** (squad-56df9e28): 1856 -> 1857. Judge: "The output states that Nikola Tesla was born on 10 July 1857, so the year is 1857."
- **date** (squad-56df9e28): 1856 -> 1857. Judge: "The output states that Nikola Tesla was born on 10 July 1857."
- **date** (squad-56df9e28): 1856 -> 1857. Judge: "The output states that Nikola Tesla was born on 10 July 1857, correctly giving the year as 1857."
- **number** (squad-5727e6cb): 40 -> 50. Judge: "The output states that the richest 1% owned 50% of global assets."
- **number** (squad-5727e6cb): 40 -> 50. Judge: "The output directly states that the richest 1% owned 50% of global assets."
- **entity** (squad-56e16182): Computational complexity theory -> Computability theory. Judge: "The output identifies computability theory as the branch concerned with classifying computational problems by difficulty and relating the resulting classes."
- **entity** (squad-57273a46): Construction -> Engineering. Judge: "The output directly identifies engineering as the process of constructing a building or infrastructure."
- **entity** (squad-57273a46): Construction -> Engineering. Judge: "The output identifies engineering as the process of constructing a building or infrastructure, which answers the question."
- **negation** (squad-570d2417): is -> is not. Judge: "The output describes Victoria's economy as primarily service-sector-based, while also noting manufacturing and several major industries, which answers what kind of economy it has."
