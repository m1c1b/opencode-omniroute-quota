# Project guidance

This package is an OpenCode 2.1 TUI plugin for OmniRoute account quotas. Keep the UI text in English.

## Structure and runtime

- `src/tui.tsx` registers the sidebar and details panel, renders both styles, and handles interaction.
- `src/quota.ts` fetches and parses usage and optional provider labels, groups accounts, and calculates summaries.
- `src/poller.ts` manages refresh, timeout, stale state, and cleanup; `src/api-key.ts` resolves keys.
- `build.ts` bundles the TUI with the Solid transform. `tui.js` re-exports `dist/tui.js` for root-based loading; the npm `./tui` export points directly to the bundle. Preserve both entry paths. `prepack` builds the bundle.
- Target the OpenCode 2.1 TUI plugin API, not a server plugin. Keep slot registration, panel ownership, key handling, and cleanup compatible with that API.

## Quotas and presentation

- Provider groups retain API order unless `pinnedProvider` matches a group, which moves it first. Account order remains unchanged. The section starts expanded. Its collapsed header summarizes only the first displayed provider, with no fallback to another provider. The expanded header shows the last successful plugin fetch time, not upstream cache freshness.
- Automatic polling only reads cached usage. Manual refresh first posts to provider limits, then reads the cache; it requires a management token with `manage` or `admin` scope.
- For each 5h or 7d window, use `(Σtotal - Σused) / Σtotal * 100`, clamped to 0–100. Include only matching, limited quotas with finite actual `used` and `total` and positive `total`; never derive header usage from remaining percentages. Missing windows display `—`.
- Individual quotas use reported remaining percentages when available. For AGY, use explicit aggregate groups and explicit matching durations for header windows; do not invent a 5h duration for session groups or infer shared pools from model names. Retain individual quotas in details.
- Keep `bar-style` as the default and `percents-only-style` as the alternative. Preserve account name masking in the sidebar and avoid exposing identifying labels in examples.
- Sidebar layout must fit narrow and wide terminals. Use render capture tests at 32 and 70 columns, check for overflow, and account for OpenTUI flex sizing (including `flexShrink`) when changing rows.

## Security and configuration

- Options and `{env:NAME}` API-key references resolve in the TUI process, not the OpenCode server. Preserve the existing option names and defaults documented in README.
- The usage request uses a Bearer key; the optional `/api/providers` management response can contain sensitive fields. Do not log keys, responses, or server error bodies, or persist them to disk. Keep URL validation and redirect rejection intact.

## Development

Install with `bun install --frozen-lockfile`. Run `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build` as appropriate. Tests require Bun's browser condition: the test script runs `bun --conditions=browser test`. `npm pack` invokes `prepack` and requires Bun and installed development dependencies.
