#!/bin/sh
# Run every judge config matching a pattern over one dataset, one lane per model.
#   JM_KEY=... scripts/run-matrix.sh data/squad/cases.jsonl runs/squad
# The key is read from the environment only; it is never written to disk.
set -u
cases="$1"; out="$2"
lane() {
  for judge in judges/*."$1".json; do
    name=$(basename "$judge" .json)
    node src/cli.ts run --cases "$cases" --judge "$judge" --out "$out/$name" --concurrency "$2" > "$out/$name.log" 2>&1
    echo "$name done (exit $?)"
  done
}
mkdir -p "$out"
lane luna 4 &
lane gemini 3 &
wait
echo "matrix done"
