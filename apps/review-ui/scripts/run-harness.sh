#!/usr/bin/env bash
# v0 harness driver. Loops over every case ID, calls the harness-case
# endpoint once per, collects the JSON responses, writes a summary.
#
# Usage:
#   CRON_SECRET=... ./scripts/run-harness.sh [caseId1 caseId2 ...]
# If no case IDs are passed, runs the full case set.
#
# Requires: curl, jq, python3 (for JSON pretty-print in the summary).

set -euo pipefail

BASE_URL="${BASE_URL:-https://email-sndr-platform.vercel.app}"
if [ -z "${CRON_SECRET:-}" ]; then
  echo "ERROR: CRON_SECRET env var required" >&2
  exit 1
fi

TS="$(date +%s)"
OUT_DIR="./harness-runs/${TS}"
mkdir -p "${OUT_DIR}"
echo "Writing results to ${OUT_DIR}"

# Default case list — kept in sync with cases.ts. Update when new cases land.
DEFAULT_CASES=(
  car-g87-m2
  car-f1-lm
  car-sti
  car-993-carrera
  car-e30-m3
  hc-dutch-oven-braise
  hc-smash-burger
  hc-salmon-plated
  hc-wok-stirfry
  tasting-book-fire-next-time
  tasting-book-meditations
  tasting-film-conclave-poster
  tasting-product-fellow-opus
  tasting-drink-smith-cross
  hero-kaikoura-whales
  coverdetail-kaikoura-whale
  coverdetail-obidos-street
)

if [ "$#" -gt 0 ]; then
  CASES=("$@")
else
  CASES=("${DEFAULT_CASES[@]}")
fi

SUMMARY="${OUT_DIR}/summary.jsonl"
: > "${SUMMARY}"

for case_id in "${CASES[@]}"; do
  echo "--- ${case_id} ---"
  raw="$(curl -sS -m 320 --http1.1 \
    "${BASE_URL}/api/admin/harness-case?caseId=${case_id}&n=3" \
    -H "Authorization: Bearer ${CRON_SECRET}" || true)"
  if [ -z "${raw}" ]; then
    echo "  (empty response — network or timeout)"
    echo "{\"caseId\":\"${case_id}\",\"error\":\"empty response\"}" >> "${SUMMARY}"
    continue
  fi
  echo "${raw}" > "${OUT_DIR}/${case_id}.json"
  # Print one-line summary
  summary_line="$(echo "${raw}" | python3 -c "
import sys, json
try:
  d = json.loads(sys.stdin.read())
  cid = d.get('caseId','?')
  slot = d.get('slot','?')
  route = d.get('route','?')
  ws = d.get('winningScore', d.get('score', '?'))
  passed = d.get('passed', None)
  err = d.get('error')
  latency = d.get('latencyMs','?')
  if err:
    print(f'  FAIL  {cid:35s}  slot={slot:20s}  ERR: {err[:80]}')
  else:
    tag = 'PASS' if passed else 'FAIL'
    print(f'  {tag}  {cid:35s}  slot={slot:20s}  route={route:20s}  score={ws:3d}  {latency}ms')
except Exception as e:
  print(f'  parse err: {e}')
")"
  echo "${summary_line}"
  echo "${raw}" >> "${SUMMARY}"
done

echo ""
echo "=== HARNESS RUN COMPLETE ==="
echo ""
python3 <<PY
import json
counts = {"pass": 0, "fail": 0, "err": 0}
by_slot: dict = {}
with open("${SUMMARY}") as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
        except Exception:
            counts["err"] += 1
            continue
        slot = d.get("slot", "unknown")
        by_slot.setdefault(slot, {"pass": 0, "fail": 0, "err": 0})
        if d.get("error"):
            counts["err"] += 1
            by_slot[slot]["err"] += 1
        elif d.get("passed"):
            counts["pass"] += 1
            by_slot[slot]["pass"] += 1
        else:
            counts["fail"] += 1
            by_slot[slot]["fail"] += 1
print(f"Overall: {counts['pass']} pass / {counts['fail']} fail / {counts['err']} errors")
print()
print("By slot:")
for s, c in sorted(by_slot.items()):
    total = c['pass'] + c['fail'] + c['err']
    rate = (100 * c['pass'] / total) if total else 0
    print(f"  {s:30s}  {c['pass']:2d}/{total} pass ({rate:.0f}%)  fail={c['fail']}  err={c['err']}")
PY
echo ""
echo "Case JSONs under: ${OUT_DIR}"
echo "Summary JSONL:     ${SUMMARY}"
