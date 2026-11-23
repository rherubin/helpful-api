#!/usr/bin/env bash
# Run gitleaks against either a commit range or the current working tree.
#
#   gitleaks-scan.sh range <base-sha> <head-sha>   new commits only (PRs, pushes)
#   gitleaks-scan.sh tree                          every tracked and untracked file as checked out
#
# Findings are always redacted so secret values never reach CI logs.
# Run from the repository root. Needs `gitleaks` on PATH.
set -euo pipefail

mode="${1:-}"
zero_sha="0000000000000000000000000000000000000000"
args=(--config .gitleaks.toml --redact=100 --no-banner --verbose)

case "$mode" in
  range)
    base="${2:-}"
    head="${3:-}"
    if [ -z "$head" ]; then
      echo "usage: $0 range <base-sha> <head-sha>" >&2
      exit 2
    fi
    if [ -z "$base" ] || [ "$base" = "$zero_sha" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
      # New branch or an unknown base: scan the most recent commits instead of
      # the whole history so old, already-reviewed history never blocks.
      echo "No usable base commit; scanning the last 20 commits up to ${head}."
      log_opts="-20 ${head}"
    else
      log_opts="${base}..${head}"
    fi
    echo "Scanning commit range: ${log_opts}"
    exec gitleaks git "${args[@]}" --log-opts="${log_opts}" .
    ;;
  tree)
    echo "Scanning the working tree."
    exec gitleaks dir "${args[@]}" .
    ;;
  *)
    echo "usage: $0 range <base-sha> <head-sha> | tree" >&2
    exit 2
    ;;
esac
