#!/usr/bin/env bash
# A ruleset can keep others from pushing release tags, but not require them
# to be signed or to point at main, so release workflows check both.
set -euo pipefail

repo="$1"
tag="$2"
commit="$3"

ref="$(gh api "repos/$repo/git/ref/tags/$tag")"
if [ "$(jq -r .object.type <<<"$ref")" != tag ]; then
  echo "::error::$tag is a lightweight tag; release with a signed tag"
  exit 1
fi
object="$(gh api "repos/$repo/git/tags/$(jq -r .object.sha <<<"$ref")")"
if [ "$(jq -r .verification.verified <<<"$object")" != true ]; then
  echo "::error::GitHub could not verify the signature of $tag"
  exit 1
fi
if [ "$(jq -r .object.sha <<<"$object")" != "$commit" ]; then
  echo "::error::$tag does not point at the commit being built"
  exit 1
fi
status="$(gh api "repos/$repo/compare/main...$commit" --jq .status)"
if [ "$status" != identical ] && [ "$status" != behind ]; then
  echo "::error::$tag points at a commit that is not on main"
  exit 1
fi
