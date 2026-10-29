/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createSignal } from "solid-js"
import { createPoller, type State } from "./poller"
import { resolveApiKey } from "./api-key"
import { groupAccounts, summarizeQuotas, type Account, type Quota } from "./quota"

const initial: State = { accounts: null, status: "loading", updatedAt: null }
const duration = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 1000 ? value : fallback
const shortId = (id: string) => id.slice(0, 8)
const accountName = (account: Account) => account.label ?? `Аккаунт [${shortId(account.id)}]`

function windowType(quota: Quota): "5ч" | "7д" | null {
  if (quota.windowSeconds === 18000) return "5ч"
  if (quota.windowSeconds === 604800) return "7д"
  if (quota.windowSeconds != null) return null
  const name = `${quota.key ?? ""} ${quota.name}`.toLowerCase()
  if (/\b(weekly|week|7d|7 days?)\b/.test(name)) return "7д"
  if (/\b(5h|5 hours?)\b/.test(name)) return "5ч"
  return null
}

function compactQuota(quota: Quota): string {
  if (quota.unlimited) return "∞"
  if (quota.remaining === null) return "?"
  const value = Math.round(quota.remaining * 100) / 100
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 20)
  return `${"█".repeat(filled)}${"░".repeat(5 - filled)} ${value}%`
}

function accountSummary(account: Account): string {
  const windows = (["5ч", "7д"] as const).flatMap(label => {
    const quota = account.quotas.find(item => windowType(item) === label)
    return quota ? [`${label} ${compactQuota(quota)}`] : []
  })
  return windows.length ? windows.join(" · ") : summarizeQuotas(account.quotas)
}

function reset(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export default Plugin.define({
  id: "omni-quota",
  setup(ctx) {
    const [state, setState] = createSignal(initial)
    const bar = (remaining: number | null, unlimited = false) => {
      if (unlimited) return <text>∞</text>
      if (remaining === null) return <text>?</text>
      const filled = Math.round(Math.max(0, Math.min(100, remaining)) / 10)
      return <box flexDirection="row"><text fg={ctx.theme.text.base} width={filled}>{"█".repeat(filled)}</text><text fg={ctx.theme.text.muted} width={10 - filled}>{"░".repeat(10 - filled)}</text><text> {remaining}%</text></box>
    }
    const poller = createPoller({
      baseUrl: typeof ctx.options.baseUrl === "string" ? ctx.options.baseUrl : process.env.OMNIROUTE_BASE_URL ?? "",
      apiKey: resolveApiKey(ctx.options.apiKey),
      interval: duration(ctx.options.intervalMs, 60_000),
      timeout: duration(ctx.options.timeoutMs, 10_000),
    }, setState)

    const removeSidebar = ctx.ui.slot({
      append: "sidebar.content",
      render: () => <box flexDirection="column" paddingTop={1}>
        <text><strong>OmniRoute</strong> · {state().status}</text>
        <For each={groupAccounts(state().accounts ?? [])}>{group => <box flexDirection="column">
          <text><strong>{group.provider}</strong></text>
          <For each={group.accounts}>{account => <box flexDirection="row" paddingLeft={1}>
            <text flexShrink={1} wrapMode="none">{accountName(account)}</text>
            <text flexShrink={0} wrapMode="none">{" "}{accountSummary(account)}</text>
          </box>}</For>
        </box>}</For>
        <text>/omni-quota — подробнее</text>
      </box>,
    })

    const removePanel = ctx.ui.slot({
      append: "session.panel",
      render: input => <Show when={input.name === "omni-quota"}>
        <box flexDirection="column" height="100%" backgroundColor={ctx.theme.background.base}>
          <text flexShrink={0}><strong>{`OmniRoute: ${state().status}`}</strong>{" · /omni-quota-refresh"}</text>
          <text flexShrink={0}>Кеш OmniRoute · не гарантия маршрута</text>
          <Show when={state().updatedAt}>{time => <text flexShrink={0}>{`Получено плагином: ${new Date(time()).toLocaleString()}`}</text>}</Show>
          <scrollbox flexGrow={1} flexShrink={1}>
            <For each={groupAccounts(state().accounts ?? [])}>{group => <box flexDirection="column" paddingTop={1}>
              <text><strong>{group.provider}</strong></text>
              <For each={group.accounts}>{account => <box flexDirection="column" paddingLeft={1}>
              <text><strong>{accountName(account)} {account.plan}</strong></text>
              <For each={account.quotas}>{quota => <box flexDirection="column">
                <text>{quota.name}: осталось</text>
                {bar(quota.remaining, quota.unlimited)}
                <text>Использовано {quota.used ?? "?"} / {quota.total ?? "?"}</text>
                <text>Сброс: {reset(quota.resetAt)}</text>
              </box>}</For>
              </box>}</For>
            </box>}</For>
          </scrollbox>
        </box>
      </Show>,
    })
    ctx.keymap.layer(() => ({ mode: "global", commands: [
      { id: "omni-quota.open", title: "OmniRoute: квоты", palette: true, slash: { name: "omni-quota" }, run: () => {
        if (!ctx.ui.panel.open("omni-quota")) ctx.ui.toast.show({ message: "Откройте сессию для просмотра квот", variant: "info" })
      } },
      { id: "omni-quota.refresh", title: "OmniRoute: обновить квоты", palette: true, slash: { name: "omni-quota-refresh" }, run: () => { void poller.refresh() } },
    ] }))
    return () => { poller.stop(); removeSidebar(); removePanel() }
  },
})
