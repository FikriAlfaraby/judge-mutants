# judge-mutants: noref-rubric.gemini

43 cases. The judge passed 41 of 43 correct answers. Changes are counted only where it passed the original.

| Change | Kind | Judged | Passed | Rate | Unreadable |
|---|---|---:|---:|---:|---:|
| number | wrong (should fail) | 2 | 1 | 50% | 0 |
| entity | wrong (should fail) | 18 | 1 | 5.6% | 0 |
| negation | wrong (should fail) | 13 | 0 | 0% | 0 |
| date | wrong (should fail) | 3 | 0 | 0% | 0 |
| reformat | control (should pass) | 41 | 41 | 100% | 0 |
| filler | control (should pass) | 41 | 41 | 100% | 0 |

## Wrong answers the judge passed

- **number** (squad-5727e6cb): 40 -> 50. Judge: "The output directly answers the question by stating that the richest 1% owned 50% of global assets according to a study by the World Institute for Development Economics Research."
- **entity** (squad-57285ed5): Yuán Cháo -> Sòng Cháo. Judge: "The output provides the Chinese name for the Yuan dynasty in Chinese characters (元朝 and officially 大元), although it contains a typo in the pinyin for the former."
