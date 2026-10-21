# Vercel builds

- Every push to a PR branch costs a build. Batch commits and push once when ready for review.
- Don't merge master into a branch unless there is a real conflict.
- Open the PR right after the first push. If the PR was opened after the last push, push an empty commit to get a preview.
- The Vercel Git integration is the only deploy path. Do not deploy with the CLI or a deploy hook.
