# Vercel builds

- A PR push builds nothing unless you ask. Test on local Vite first. To get a preview, push an empty commit (`git commit --allow-empty -m "Preview"`) or put `[preview]` in the commit message. Each preview costs a build, so ask once, when ready for review.
- Don't merge master into a branch unless there is a real conflict.
- Open the PR right after the first push. A branch with no open PR never builds.
- The Vercel Git integration is the only deploy path. Do not deploy with the CLI or a deploy hook.
