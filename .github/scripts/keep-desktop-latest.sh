#!/usr/bin/env bash
# Makes the newest published desktop release GitHub's latest release again
# when anything else is, because installed desktop copies update from it.
# A desktop release withdrawn by marking it a prerelease is never restored.
set -euo pipefail

repo="$1"
# GitHub answers 404 when no release is latest; any other failure stops here.
if ! latest="$(gh api "repos/$repo/releases/latest" --jq .tag_name 2>"$RUNNER_TEMP/latest.err")"; then
  if ! grep -q 'HTTP 404' "$RUNNER_TEMP/latest.err"; then
    cat "$RUNNER_TEMP/latest.err" >&2
    exit 1
  fi
  latest=''
fi
if [[ "$latest" == desktop-v* ]]; then
  exit 0
fi
newest="$(gh api --paginate "repos/$repo/releases" \
  --jq '.[] | select(.draft == false and .prerelease == false) | .tag_name | select(test("^desktop-v[0-9]+\\.[0-9]+\\.[0-9]+$"))' |
  sed 's/^desktop-v//' | sort -V | tail -1)"
if [ -z "$newest" ]; then
  echo "::error::${latest:-No release} is GitHub's latest release, and there is no desktop release to put back"
  exit 1
fi
gh release edit "desktop-v$newest" --repo "$repo" --latest
echo "::warning::${latest:-No release} was GitHub's latest release; desktop-v$newest is latest again"
