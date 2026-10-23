#!/usr/bin/env bash
# Vercel: exit 0 skips the build; exit 1 builds.
# Production always builds. A PR preview builds only when asked for:
# push an empty commit, or put [preview] in the commit message.
if [[ "${VERCEL_ENV:-}" == "production" ]]; then
  echo "Build: production deployment."
  exit 1
fi

if [[ -z "${VERCEL_GIT_PULL_REQUEST_ID:-}" ]]; then
  echo "Skip: branch has no open PR."
  exit 0
fi

message=${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --format=%B HEAD 2>/dev/null)}
if [[ "$message" == *"[preview]"* ]]; then
  echo "Build: commit message asks for a preview."
  exit 1
fi

# An empty commit is the other way to ask. Missing history counts as not
# empty, so a shallow clone skips rather than builds.
if git rev-parse --verify HEAD^ >/dev/null 2>&1 && git diff --quiet HEAD^ HEAD; then
  echo "Build: empty PR commit asks for a preview."
  exit 1
fi

echo "Skip: no preview asked for. Push an empty commit or add [preview] to build one."
exit 0
