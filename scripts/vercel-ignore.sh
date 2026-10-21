#!/usr/bin/env bash
# Vercel: exit 0 skips the build; exit 1 builds.
if [[ "${VERCEL_ENV:-}" == "production" ]]; then
  echo "Build: production deployment."
  exit 1
fi

if [[ -z "${VERCEL_GIT_PULL_REQUEST_ID:-}" ]]; then
  echo "Skip: branch has no open PR."
  exit 0
fi

# Inspect both sides of renames, and preserve unusual filenames with NULs.
# Missing history must build so a shallow clone cannot hide code changes.
if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  echo "Build: previous commit unavailable."
  exit 1
fi

changes=$(mktemp) || { echo "Build: cannot inspect changed files."; exit 1; }
trap 'rm -f "$changes"' EXIT
if ! git diff --name-only --no-renames -z HEAD^ HEAD > "$changes"; then
  echo "Build: cannot inspect changed files."
  exit 1
fi

while IFS= read -r -d '' path; do
  case "$path" in
    *.md|docs/*) ;;
    *) echo "Build: PR commit changes application files."; exit 1 ;;
  esac
done < "$changes"

# An empty commit intentionally triggers a preview after opening a PR.
if [[ ! -s "$changes" ]]; then
  echo "Build: empty PR commit requests a preview."
  exit 1
fi
echo "Skip: PR commit changes only Markdown or docs/."
exit 0
