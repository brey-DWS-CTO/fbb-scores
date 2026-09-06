# Working rules for this repo

Read this before touching anything. `HANDOFF.md` says what the app is and how it
is built. This file says how work gets in.

## The league is live

Ten people signed in on 5 September 2026. The draft is Sunday 18 October 2026,
2:00 PM Pacific. Keepers are due 24 hours earlier, per rule
`keepers.select.deadline`. From here, a broken master is somebody's real
afternoon, not a note in a log.

## Branches and pull requests, always

1. Branch off master. `git switch -c fix/<short-name>` or
   `feat/<short-name>`.
2. Commit there.
3. `git push -u origin <branch>` then `gh pr create --fill`.
4. Check the change on localhost. See the note below on previews.
5. Merge the pull request.
6. Deploy production as its own step (see below).

### Deploying is a separate step, for now

The Vercel project has **no GitHub link**. Pushing does not build a preview,
and merging does not deploy. Every deployment so far has come from the CLI.

So after merging, production is still running the old code until somebody
deploys it:

```bash
ALLOW_MASTER=1 npm run ship
```

That is the honest state of things, not the intended one. **Connect the
project to GitHub** and this gets better in every way: a preview per branch to
check a change on a real phone, and production deploying itself on merge. It
needs the Vercel GitHub app authorised on `brey-DWS-CTO/fbb-scores`, which
only the repo owner can do, in a browser. `vercel git connect` fails until
then.

Once it is connected, delete this section and put the deploy back where it
belongs: merging.

Two things are blocked in the primary checkout by
`.claude/hooks/guard_master.py`, wired up in `.claude/settings.json`:

- `git commit` while on master
- `npm run ship`, which pushes and deploys production in one step

For a genuine production emergency, and only then:

```bash
ALLOW_MASTER=1 npm run ship
```

Set it deliberately, in one command, and say in the commit message why.

## Two agents never share a checkout

Give every concurrent agent its own git worktree.

```bash
git worktree add -b feat/<name> .claude/worktrees/<name> master
```

A worktree dies with its branch. Merging is four steps, not three: merge the
PR, delete the remote branch, `git worktree remove`, `git worktree prune`. A
worktree that outlives its merged branch is a decoy, not isolation.

Windows locks files. If `git worktree remove` says the directory is busy, some
process still holds it. Unregister it with `git worktree prune` and delete the
folder later rather than leaving it registered.

## Before any PR

All three must be clean:

```bash
npm test
npm run lint
npm run build
```

Never run `npm run build` while the dev server is up. Both write to the same
place and the dev server then serves nothing.

## Conventions that keep biting

- **Pure logic lives in `src/lib/league/*.ts`** and is tested with no server
  and no browser. The UI and the server stay thin over it. See
  `src/lib/league/polls.ts` and `tests/polls.test.ts` for the shape.
- **`src/index.css` is append-only per feature.** On a merge conflict there,
  the answer is almost always keep both sides. The block titled "Offsets around
  the two nav bars" must stay the last thing in the file: it beats the earlier
  `top: 0` sticky rules by cascade order and nothing else does.
- **The keeper engine is the only place keeper maths happens**
  (`src/lib/keeper/engine.ts`). Never re-implement it.
- **Owner names are the key to every permission.** An email address only says
  which owner you are. Do not make an address, or anything else, a second
  identity.
- **Never put personal data in the committed config.**
  `src/data/source/league-2027-config.json` ships to the browser. Email
  addresses live in the database.
- TypeScript is strict: `erasableSyntaxOnly`, `noUnusedLocals`, no enums, and
  there is no underscore escape for an unused variable.

## Writing

Orwell's rules, everywhere: UI copy, errors, emails, commit messages, PR
bodies. Short words. Cut every word you can. Active voice. No jargon. **No em
dashes.** Aim at a 12th grade reading level.
