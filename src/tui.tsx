/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createSignal } from "solid-js"
import { createPoller, type State } from "./poller"
import { resolveApiKey } from "./api-key"
import { summarizeQuotas } from "./quota"
import type { Account, Quota } from "./quota"

const initial: State = { accounts: null, status: "loading", updatedAt: null }
const duration = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 1000 ? value : fallback
const shortId = (id: string) => id.slice(0, 8)
const pct = (quota: Quota) => quota.unlimited ? "∞" : quota.remaining === null ? "?" : `${quota.remaining}%`
const accountName = (account: Account) => `${account.provider} ${account.plan} [${shortId(account.id)}]`

function reset(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export default Plugin.define({
  id: "omni-quota",
  setup(ctx) {
    const [state, setState] = createSignal(initial)
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
        <For each={state().accounts ?? []}>{account =>
          <text>{account.provider} [{shortId(account.id)}]: {summarizeQuotas(account.quotas)}</text>
        }</For>
        <text>/omni-quota — подробнее</text>
      </box>,
    })

    const removePanel = ctx.ui.slot({
      append: "session.panel",
      render: input => <Show when={input.name === "omni-quota"}>
        <box flexDirection="column" height="100%" backgroundColor={ctx.theme.background.base}>
          <text flexShrink={0}><strong>{`OmniRoute: ${state().status}`}</strong>{" · /omni-quota-refresh"}</text>
          <text flexShrink={0}>Кеш OmniRoute · сырые проценты, не гарантия маршрута</text>
          <Show when={state().updatedAt}>{time => <text flexShrink={0}>{`Получено плагином: ${new Date(time()).toLocaleString()}`}</text>}</Show>
          <scrollbox flexGrow={1} flexShrink={1}>
            <For each={state().accounts ?? []}>{account => <box flexDirection="column" paddingTop={1}>
              <text><strong>{accountName(account)}</strong></text>
              <For each={account.quotas}>{quota => <box flexDirection="column">
                <text>{quota.name}: осталось {pct(quota)}; использовано {quota.used ?? "?"} / {quota.total ?? "?"}</text>
                <text>Сброс: {reset(quota.resetAt)}</text>
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
