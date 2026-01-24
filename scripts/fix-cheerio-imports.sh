#!/usr/bin/env bash
# Rewrites Cheerio imports to the modern ESM style using portable shell (no mapfile/readarray).
# Usage: scripts/fix-cheerio-imports.sh [path ...]
set -euo pipefail

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=("src")
fi

changed=0
# Find .js files under the targets
while IFS= read -r -d '' file; do
  if grep -Eq "from[[:space:]]+['\"]cheerio['\"]" "$file"; then
    # Replace "import cheerio from 'cheerio'" with "import { load } from 'cheerio'"
    sed -i '' -E "s#^import[[:space:]]+cheerio[[:space:]]+from[[:space:]]+['\"]cheerio['\"];?#import { load } from 'cheerio';#g" "$file" 2>/dev/null || true
    # Replace usages of cheerio.load(...) with load(...)
    sed -i '' -E "s#cheerio\.load\(#load(#g" "$file" 2>/dev/null || true
    changed=1
  fi
done < <(find "${targets[@]}" -type f -name "*.js" -print0)

if [ "$changed" -eq 1 ]; then
  echo "✔ Rewrote Cheerio imports to: import { load } from 'cheerio'"
else
  echo "No Cheerio import lines found to rewrite."
fi
