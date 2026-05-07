#!/usr/bin/env bash
#
# Per AGENTS.md house conventions:
#   "No code outside packages/distribution/src/providers/resend.ts imports
#    the `resend` npm package. Lint rule enforces this."
#
# Biome doesn't have native import-restriction rules, so this is the
# enforcement script. Runs in CI.
#
# Allowed imports:
#   - packages/distribution/src/providers/resend.ts (the adapter)
#   - package.json files (declaring the dep)
#
# Anything else gets flagged.

set -euo pipefail

ALLOWED_PATH="packages/distribution/src/providers/resend.ts"

violations=$(grep -RIn --include="*.ts" --include="*.tsx" --include="*.mts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  -E '^(import|from) .*"resend"|from "resend"' . 2>/dev/null \
  | grep -v "^./${ALLOWED_PATH}:" \
  || true)

if [ -n "$violations" ]; then
  echo "ERROR: 'resend' imported outside the provider adapter:"
  echo ""
  echo "$violations"
  echo ""
  echo "Per AGENTS.md, only ${ALLOWED_PATH} may import the resend package."
  echo "Use the @platform/distribution provider abstraction instead."
  exit 1
fi

echo "✓ resend import boundary respected"
