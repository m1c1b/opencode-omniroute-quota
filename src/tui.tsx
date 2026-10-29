/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createSignal, onMount } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
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

const hasWindows = (account: Account) => account.quotas.some(quota => windowType(quota) !== null)
const truncate = (value: string, width: number) => value.length > width ? `${value.slice(0, width - 1)}…` : value

function reset(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export default Plugin.define({
  id: "omni-quota",
  setup(ctx) {
    const [state, setState] = createSignal(initial)
    const [sidebarWidth, setSidebarWidth] = createSignal(32)
    const columns = () => sidebarWidth() >= 60 ? 2 : 1
    const cardWidth = () => Math.floor((sidebarWidth() - (columns() - 1)) / columns())
    const barWidth = () => Math.max(1, Math.min(10, cardWidth() - 16))
    const compactBar = (remaining: number | null, unlimited = false) => {
      if (unlimited) return "∞"
      if (remaining === null) return "?"
      const filled = Math.round(Math.max(0, Math.min(100, remaining)) * barWidth() / 100)
      return `${"█".repeat(filled)}${"░".repeat(barWidth() - filled)} ${remaining}%`
    }
    const compactWindow = (account: Account, label: "5ч" | "7д") => {
      const quota = account.quotas.find(item => windowType(item) === label)
      if (!quota) return null
      return compactBar(quota.remaining === null ? null : Math.round(quota.remaining * 100) / 100, quota.unlimited)
    }
    const summaryBar = (account: Account) => {
      const limited = account.quotas.filter(quota => !quota.unlimited)
      const known = limited.flatMap(quota => quota.remaining === null ? [] : [quota.remaining])
      return compactBar(known.length ? Math.min(...known) : null, account.quotas.length > 0 && !limited.length)
    }
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
      render: () => {
        let sidebar!: BoxRenderable
        onMount(() => setSidebarWidth(sidebar.width))
        return <box ref={sidebar} flexDirection="column" width="100%" paddingTop={1} onSizeChange={function () { setSidebarWidth(this.width) }}>
        <text height={1} flexShrink={0}><strong>OmniRoute</strong> · {state().status}</text>
        <For each={groupAccounts(state().accounts ?? [])}>{group => <box flexDirection="column" flexShrink={0}>
          <text height={1} flexShrink={0}><strong>{group.provider.toUpperCase()}</strong></text>
          <text height={1} flexShrink={0} fg={ctx.theme.text.muted}>{"─".repeat(sidebarWidth())}</text>
          <For each={Array.from({ length: Math.ceil(group.accounts.length / columns()) }, (_, i) => group.accounts.slice(i * columns(), (i + 1) * columns()))}>{(row, rowIndex) => <box flexDirection="row" flexShrink={0} gap={1}>
            <For each={row}>{(account, accountIndex) => <box width={cardWidth()} flexShrink={0} flexDirection="column">
              <text wrapMode="none">{truncate(`${rowIndex() * columns() + accountIndex() + 1}. ${accountName(account)}`, cardWidth())}</text>
              <Show when={hasWindows(account)} fallback={<>
                <text wrapMode="none">{truncate(summarizeQuotas(account.quotas), cardWidth())}</text>
                <text wrapMode="none">{summaryBar(account)}</text>
              </>}>
                <For each={(["5ч", "7д"] as const).filter(label => compactWindow(account, label) !== null)}>{(label, index) => <><Show when={index() > 0}><text height={1}> </text></Show><text wrapMode="none">{compactWindow(account, label)} {label}</text></>}</For>
              </Show>
            </box>}</For>
          </box>}</For>
        </box>}</For>
        <text>/omni-quota — подробнее</text>
      </box>},
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
