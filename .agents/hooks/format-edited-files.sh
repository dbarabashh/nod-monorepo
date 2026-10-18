#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
repo_root="$(git rev-parse --show-toplevel)"

while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    /*) path="$file" ;;
    *) path="$repo_root/$file" ;;
  esac
  [ -f "$path" ] || continue
  path="$(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")"
  case "$path" in
    "$repo_root"/*) ;;
    *) continue ;;
  esac
  case "$path" in
    *.ts|*.mts|*.cts|*.js|*.mjs|*.cjs)
      (cd "$repo_root" && pnpm exec oxlint --fix "$path" >/dev/null 2>&1) || true
      (cd "$repo_root" && pnpm exec oxfmt --write "$path" >/dev/null 2>&1) || true
      ;;
    *.json|*.css|*.html|*.md|*.yaml|*.yml)
      (cd "$repo_root" && pnpm exec oxfmt --write "$path" >/dev/null 2>&1) || true
      ;;
  esac
done < <(
  jq -r '
    .tool_input as $input
    | (
        $input.file_path?,
        $input.files?[]?.file_path?,
        ($input.command? // ""
          | scan("(?m)^\\*\\*\\* (?:Add|Update) File: ([^\\r\\n]+)$")
          | .[0])
      )
    | select(type == "string" and length > 0)
  ' <<<"$payload"
)
