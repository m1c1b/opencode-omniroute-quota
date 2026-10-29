# OmniRoute Quota for OpenCode

This OpenCode V2 TUI plugin shows quotas for all OmniRoute accounts in the session sidebar. The details panel shows each quota, usage and reset time.

## Installation

OpenCode 2.1.0 and Bun are required. In the project directory:

```sh
bun install --frozen-lockfile
bun run build
```

To run without changing global configuration, provide an absolute path to the package directory:

```sh
OMNIROUTE_API_KEY="$(dotenvx get OMNIROUTE_API_KEY -f ~/.env)" \
OMNIROUTE_BASE_URL="https://omniroute.m1c1b.dev:8443" \
OPENCODE_CLI_CONFIG_CONTENT='{"plugins":[{"package":"file:///absolute/path/to/opencode-omni-quota","options":{"apiKey":"{env:OMNIROUTE_API_KEY}","intervalMs":60000,"timeoutMs":10000}}]}' \
opencode
```

Set `OMNIROUTE_API_KEY` before starting the TUI. In `~/.config/opencode/cli.json`, use `"apiKey": "{env:OMNIROUTE_API_KEY}"` for the plugin; do not put the key itself in configuration. The plugin resolves this reference in the TUI process environment, not the server environment. For example, launchctl must pass the variable to the TUI process. When `apiKey` is omitted, `OMNIROUTE_API_KEY` is used; an explicit value takes precedence. An unknown or empty variable produces `unavailable` without an HTTP request. `OMNIROUTE_BASE_URL` can be used instead of `baseUrl`; `baseUrl` takes precedence. Interval and timeout are in milliseconds, with a minimum of 1000. Invalid values use the defaults.

The command passes the key only through the process environment. It does not print or save the key in configuration.

The plugin option `options.style` selects the display: `"bar-style"` shows bars, while `"percents-only-style"` shows a table without bars. The default is `"bar-style"`; invalid values also fall back to it. For example: `"options": { "style": "percents-only-style" }`. The setting also applies to the details panel.

The plugin calls `/api/usage/om-usage?format=json` with a Bearer key. Use HTTPS for remote servers. Redirects are rejected to avoid sending the key to another server. The plugin does not save keys or responses to disk or display server error text.

## Usage

Open a session and its sidebar. `/omni-quota` opens the details panel within a session; on the home screen it asks you to open a session. `/omni-quota-refresh` refreshes the cache. Both commands are also available in the palette. Polling is automatic and requests do not overlap.

Statuses: `loading` means the first request is pending; `ready` means data is available; `unavailable` means no data is available; `stale` means the request failed and the last successful data is shown. Reset times use the local time zone. Account IDs are shortened to eight characters.

The summary shows the number of quotas and the minimum known remaining percentage among limited quotas. `∞` means all quotas are unlimited; `?` means the remainder is unknown. When known and unknown values are mixed, `+ ?` appears next to the minimum.

The sidebar groups and numbers accounts by provider. The default style shows a full-width rule below the provider, vertically arranged accounts, and bars using the available width. Five-hour and seven-day windows appear separately when present. Other quotas show a summary and minimum remainder. Email addresses are shortened to the part before `@`.

For AGY, the sidebar shows explicitly marked API aggregates by group and window when available. These are OmniRoute values, not plugin-calculated model minima. Shared pools are not inferred from model names. The details panel retains every quota, including individual models. Without aggregates, the ordinary summary is shown.

The endpoint reads the OmniRoute cache rather than querying providers. Cache age is unknown. The panel time only records when the plugin received the response. Accounts without cached quotas are absent from the response. Percentages are raw provider values without thresholds or reserves and do not guarantee route availability. JSON responses may differ from `@@om-usage` output, which accounts for thresholds. HTTP 401 and 403 appear as `unavailable` or `stale`: check the key and OmniRoute's `allowUsageCommand` setting. Management authentication is not required for this endpoint.

## Development

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```
