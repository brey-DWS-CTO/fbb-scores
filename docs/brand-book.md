# FBB Scores brand and UI guide

Use this guide when adding or changing UI. Reuse existing components and theme tokens before introducing new styling. My Team is the reference for compact roster and projection rows; Performers is the reference for player news, stat breakdowns, and game links.

## Player identity

- Compact names use `shortName`: first initial and surname (J. Murray). Preserve the full name in the accessible label or title.
- In compact roster and projection rows, place the NBA team logo immediately after the name with a 4px gap. Never push it to the far edge of the row.
- Use the shared `TeamLogo` component: 16px in roster rows, 14px in the narrow projection player column. Keep the logo from shrinking.
- Show roster eligibility inline after the logo in muted text, such as PG/SG. Use actual eligible base positions; omit generic G/F/UTIL and reserve slots.
- Keep roster slot labels separate from player eligibility. Lock state belongs at the trailing edge.

## Density and mobile

- My Team opens on Roster, followed by Projections.
- Read-only roster rows target 34px height with thin separators and subtle alternating backgrounds. Avoid individual cards and large gaps for repeated players.
- Interactive lineup rows retain at least 44px height. Do not sacrifice touch targets for density.
- Keep player identity on one line; truncate long display names and preserve full accessible names. Eligibility and logos stay visible.
- Projection games contain only opponent and projected points, on two compact lines. Pack actual games chronologically without off-day columns.
- Recommended starts use bold text and the theme teal accent on both opponent and points. Bench options use `--text-mid`; locked/completed games use `--text-body` and a small inline lock glyph. Explain these states once in a compact legend; avoid repeated badges.
- Roster average columns stay together as Season / L3 / L7 / L15. These mean completed games, with a sample marker for short windows; never relabel day-based windows as games.
- Use the actual weekly cap and include already-used games in the planned count. Passed tip-off locks a game even if its feed still says upcoming.
- Keep matchup reference tables collapsed by default. Use the shared MatchupTables component for Pace / Vs position, a bounded scrolling table, adjacent 16px team logos, and explicit scoring/sample-size labels.
- Keep the player column sticky when the schedule scrolls horizontally. The page itself must fit the mobile viewport.

## Theme and typography

- Reuse the Inter/system font stack and existing CSS variables from `src/index.css`.
- Use `--text-mid` for secondary metadata, `--panel-border` for separators, and `--neon-teal` for active navigation and recommendations. Use tokens so light and dark themes remain consistent.
- Use tabular numbers for scores and totals. Keep headings and controls compact above dense lists.
- Use shared `NavIcon`, `TeamLogo`, player news, and points breakdown components for their existing roles.

## Review checklist

- Check both themes and a 390px mobile viewport.
- Confirm names, adjacent logos, and eligible positions stay aligned for long names and empty slots.
- Confirm no page overflow, unnecessary stacked metadata, or extra card spacing.
- Confirm keyboard focus, full accessible player names, and touch target sizes remain usable.
- Compare related screens before introducing a new pattern; update this guide when a shared convention changes.
