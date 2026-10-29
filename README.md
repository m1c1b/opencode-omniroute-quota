# OmniRoute Quota for OpenCode

An OpenCode TUI plugin that shows OmniRoute account quotas in the session sidebar. Open the details panel to inspect individual quotas, usage and reset times.

## Requirements

- OpenCode 2.1.0. The plugin targets its V2 TUI plugin API.
- An OmniRoute server and a key authorized to access its usage endpoint.
- Bun for building the plugin from source or packing it for npm.

## Installation

The package has not yet been published to npm. After publication, add the following entry to `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    {
      "package": "opencode-omni-quota",
      "options": {
        "baseUrl": "https://omniroute.example.com",
        "apiKey": "{env:OMNIROUTE_API_KEY}"
      }
    }
  ]
}
```

Set `OMNIROUTE_API_KEY` in the environment of the process that starts the OpenCode TUI. The plugin resolves environment references in the TUI process, not the server process. Avoid putting the key directly in configuration. You can also omit `apiKey` and use `OMNIROUTE_API_KEY` automatically.

### Run from a local checkout

Install dependencies and build the plugin in the checkout:

```sh
bun install --frozen-lockfile
bun run build
```

Use a `file://` URL pointing to the absolute path of the checkout instead of the package name in the configuration above. For example, `file:///absolute/path/to/opencode-omni-quota`. Set the API key in the TUI process environment before starting OpenCode.

## Options

Click the OmniRoute sidebar header to collapse or expand the whole section. It starts expanded.
When collapsed, the header shows remaining percentages for 5h and 7d windows in the first displayed provider group. Missing windows appear as —, and long provider names are truncated to retain the percentages.
When expanded, the header shows the last successful plugin fetch time, not the freshness of the server's upstream data. A stale or unavailable status remains visible after a failed fetch.
For each window, the percentage is `(Σtotal - Σused) / Σtotal * 100`, clamped to 0–100. It sums matching quotas across accounts, not their percentages.
Only finite actual `used` and `total` values with `total > 0` qualify; unlimited quotas are excluded. The header never derives usage from `remaining` or `remainingPercentage`. Antigravity uses aggregate groups with explicit matching durations only.
The header marks stale or unavailable data; windows without eligible quotas are omitted without falling back to another provider. Individual account displays still use the reported remaining percentage when available.

The default `bar-style` shows each account's quota windows as shaded bars, with
labels on the left and percentages on the right. Missing windows show `—` and
an empty bar. Unknown values show `?`, and unlimited quotas show `∞`. Antigravity
groups use their actual model and window labels. Long labels may be shortened in
narrow sidebars. Bars use the [ascii-bar Shaded character set](https://github.com/tbremer/ascii-bar).

All options belong in the plugin entry's `options` object.

| Option | Default | Description |
| --- | --- | --- |
| `baseUrl` | `OMNIROUTE_BASE_URL`, or empty | OmniRoute server URL. An explicit string takes precedence over the environment variable. |
| `apiKey` | `OMNIROUTE_API_KEY`, or empty | Bearer key or `{env:VARIABLE_NAME}` reference. An explicit string takes precedence over the environment variable. |
| `style` | `bar-style` | Use `bar-style` for bars or `percents-only-style` for a table without bars. Applies to the sidebar and details panel. Invalid values use `bar-style`. |
| `intervalMs` | `60000` | Polling interval in milliseconds. Must be a finite number of at least `1000`; invalid values use the default. |
| `timeoutMs` | `10000` | Request timeout in milliseconds. Must be a finite number of at least `1000`; invalid values use the default. |

An empty or unresolved key, or an empty base URL, produces `unavailable` without a request. The URL must use HTTP or HTTPS and must not contain credentials.

## Usage

Open a session and its sidebar. Run `/omni-quota` to open the details panel, or `/omni-quota-refresh` to refresh the cache. Both commands are also available in the command palette. Polling is automatic; requests do not overlap.

The status is `loading` while the first request is pending, `ready` when data is available, `unavailable` when no data is available, or `stale` when a request fails after a successful update. Reset times use the local time zone. Account IDs are shortened to eight characters.

The sidebar groups accounts by provider. It shows separate five-hour and seven-day windows when present. Other quotas show a summary and the minimum known remaining percentage. `∞` means all quotas are unlimited; `?` means the remainder is unknown. A mixed known and unknown summary includes `+ ?`.

For AGY, the sidebar shows API aggregates by group and window when available. These are OmniRoute values, not plugin-calculated model minima. Shared pools are not inferred from model names. The details panel retains individual quotas.

The usage endpoint reads the OmniRoute cache, whose age is unknown. The panel time records when the plugin received the response. Accounts without cached quotas are absent. Percentages are raw provider values without thresholds or reserves and do not guarantee route availability. JSON responses may differ from `@@om-usage`, which accounts for thresholds. If a request returns HTTP 401 or 403, check the key and OmniRoute's `allowUsageCommand` setting.

## Security and privacy

The plugin sends the key as a Bearer token to `/api/usage/om-usage?format=json` and, when accounts are present, to `/api/providers` for optional account labels. Use HTTPS for remote servers. Redirects are rejected. The providers response may contain secrets and is processed in the TUI process memory; use a trusted OmniRoute server and protect the local environment. The plugin does not intentionally save keys or responses to disk or display server error text.

Account labels may be visible in the TUI. Email labels are shortened to the part before `@`, which can still identify an account.

## Development

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```

`npm pack` runs the build through `prepack` and therefore requires Bun and installed development dependencies.

## License

No license has been granted. All rights reserved.
