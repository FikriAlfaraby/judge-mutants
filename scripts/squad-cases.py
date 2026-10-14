"""Build data/squad/cases.jsonl from the SQuAD v1.1 dev set (CC BY-SA 4.0).

Selection rule, fixed before any judge ran: for each of the first N articles, its first paragraph's
first question. Reference = the first gold answer. Answer = the context sentence that contains that
gold answer (a correct, natural full-sentence answer, copied verbatim).

    python3 scripts/squad-cases.py /path/to/dev-v1.1.json 48 > data/squad/cases.jsonl
"""
from __future__ import annotations

import json
import re
import sys

SENTENCE = re.compile(r"[^.!?]+(?:[.!?]+(?=\s|$)|$)")


def sentence_with(context: str, start: int) -> str | None:
    for m in SENTENCE.finditer(context):
        if m.start() <= start < m.end():
            return m.group(0).strip()
    return None


def main() -> None:
    path, n = sys.argv[1], int(sys.argv[2])
    data = json.load(open(path, encoding="utf-8"))["data"]
    for article in data[:n]:
        paragraph = article["paragraphs"][0]
        qa = paragraph["qas"][0]
        gold = qa["answers"][0]
        answer = sentence_with(paragraph["context"], gold["answer_start"])
        if not answer or gold["text"] not in answer:
            print(f"skip {qa['id']}: gold answer crosses a sentence boundary", file=sys.stderr)
            continue
        # Distractors: the gold answers to the article's other questions, which are things of the
        # same text and often of the same kind (the other team, another city, another year).
        others = []
        for p in article["paragraphs"]:
            for q in p["qas"]:
                text = q["answers"][0]["text"].strip()
                if q["id"] != qa["id"] and text and text.lower() not in gold["text"].lower() and gold["text"].lower() not in text.lower() and text not in others:
                    others.append(text)
        case = {
            "id": f"squad-{qa['id'][:8]}",
            "answer": answer,
            "reference": gold["text"],
            "vars": {"question": qa["question"], "title": article["title"].replace("_", " ")},
            "distractors": others,
        }
        print(json.dumps(case, ensure_ascii=False))


if __name__ == "__main__":
    main()
