#!/usr/bin/env python3
"""Keep work off master now that the league is using the app.

Blocks two things in the primary checkout:

  * committing straight onto master
  * `npm run ship`, which pushes and deploys production in one step

Both were fine while nobody else was on the app. They are not fine now that
ten people sign in with it and the draft is weeks away. Work goes on a branch,
opens a pull request, and gets checked on the preview before it reaches anyone.

Escape hatch, for a genuine production emergency:

    ALLOW_MASTER=1 npm run ship

Set it deliberately, in one command, and say in the commit why.
"""
import json
import os
import re
import subprocess
import sys

ALLOW = os.environ.get("ALLOW_MASTER") == "1"

# `git commit` on master, and the ship script. Nothing else is blocked: reading,
# branching, merging, pushing a branch and opening a PR all stay free.
COMMIT = re.compile(r"\bgit\s+(-[^\s]+\s+)*commit\b")
SHIP = re.compile(r"\bnpm\s+run\s+ship\b|\bship-production\.mjs\b")


def current_branch() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip()
    except Exception:
        return ""


def deny(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(2)


def main() -> None:
    if ALLOW:
        return
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    command = (payload.get("tool_input") or {}).get("command") or ""
    if not command:
        return

    if SHIP.search(command):
        deny(
            "Blocked: npm run ship deploys straight to production, and the "
            "league is using the app now.\n"
            "Push the branch and open a pull request instead:\n"
            "  git push -u origin <branch>\n"
            "  gh pr create --fill\n"
            "Vercel builds a preview for the branch. Merge to master when it "
            "checks out.\n"
            "Real emergency only: ALLOW_MASTER=1 npm run ship"
        )

    if COMMIT.search(command) and current_branch() == "master":
        deny(
            "Blocked: that commit would land on master, which deploys to the "
            "league.\n"
            "Branch first:\n"
            "  git switch -c fix/<short-name>\n"
            "then commit, push, and open a pull request.\n"
            "Real emergency only: ALLOW_MASTER=1 git commit ..."
        )


if __name__ == "__main__":
    main()
