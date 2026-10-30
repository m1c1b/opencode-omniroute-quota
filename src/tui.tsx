/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createSignal, onMount } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import { createPoller, type State } from "./poller"
import { resolveApiKey } from "./api-key"
import { remainingByWindow, groupAccounts, quotaSummary, summarizeQuotas, windowType, type Account, type Quota } from "./quota"
import { shaded } from "./shaded"
export { shaded } from "./shaded"

const initial: State = { accounts: null, status: "loading", updatedAt: null }
const duration = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 1000 ? value : fallback
const shortId = (id: string) => id.slice(0, 8)
const accountName = (account: Account) => account.label ?? `Account [${shortId(account.id)}]`
export const maskAccountName = (name: string) => {
  const chars = Array.from(name)
  const prefix = chars.slice(0, 4)
  const suffix = chars.slice(Math.max(prefix.length, chars.length - 2))
  return prefix.join("") + "*".repeat(10 - prefix.length - suffix.length) + suffix.join("")
}

const hasWindows = (account: Account) => account.quotas.some(quota => windowType(quota) !== null)
const truncate = (value: string, width: number) => value.length > width ? `${value.slice(0, width - 1)}…` : value
const percent = (quota: Quota | undefined) => !quota ? "—" : quota.unlimited ? "∞" : quota.remaining === null ? "?" : `${Math.round(quota.remaining * 100) / 100}%`
const nameWidth = (sidebarWidth: number, show5h: boolean) => Math.max(7, sidebarWidth - (show5h ? 17 : 10))
const groupHas5h = (accounts: Account[]) => accounts.some(account => account.quotas.some(q => windowType(q) === "5h"))
const numberWidth = (accounts: Account[]) => Math.max(3, String(accounts.length).length + 2)
const tableRow = (account: Account, index: number, show5h: boolean, agy: boolean, numbers: number, sidebarWidth: number) => {
  const quota5h = account.quotas.find(q => windowType(q) === "5h")
  const width = nameWidth(sidebarWidth, show5h) - (numbers - 3)
  return `${`#${index + 1}`.padEnd(numbers)}${truncate(maskAccountName(accountName(account)), width).padEnd(width)}${show5h ? ` ${(quota5h || agy ? percent(quota5h) : "").padStart(6)}` : ""} ${percent(account.quotas.find(q => windowType(q) === "7d")).padStart(6)}`
}
const tableHeader = (accounts: Account[], agy: boolean, sidebarWidth: number) => agy
  ? `${"#".padEnd(numberWidth(accounts))}ACCOUNT / QUOTA`
  : `${"#".padEnd(numberWidth(accounts))}${"ACCOUNT".padEnd(nameWidth(sidebarWidth, groupHas5h(accounts)) - (numberWidth(accounts) - 3))}${groupHas5h(accounts) ? ` ${"5h".padStart(6)}` : ""} ${"7d".padStart(6)}`

function reset(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

export default Plugin.define({
  id: "omni-quota",
  setup(ctx) {
    const percentsOnly = ctx.options.style === "percents-only-style"
    const [state, setState] = createSignal(initial)
    const [expanded, setExpanded] = createSignal(ctx.options["start-closed"] !== true)
    const [sidebarWidth, setSidebarWidth] = createSignal(32)
    const groups = () => groupAccounts(state().accounts ?? [], typeof ctx.options.pinnedProvider === "string" ? ctx.options.pinnedProvider : undefined)
    const summaries = () => groups().slice(0, 1).map(group => {
      const values = remainingByWindow(group.accounts)
      return { provider: group.provider.toUpperCase(), windows: (["5h", "7d"] as const).map(window => values[window] == null ? "—" : `${Math.round(values[window])}%`) }
    })
    const updated = () => {
      const value = state().updatedAt
      if (value === null || !Number.isFinite(value)) return "—"
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("en-GB", { hour12: false })
    }
    const contentWidth = () => Math.max(1, sidebarWidth() - 2)
    const compactBar = (remaining: number | null, unlimited = false) => {
      if (unlimited) return "∞"
      if (remaining === null) return "?"
      return `${shaded(remaining, Math.max(1, contentWidth() - 8))} ${remaining}%`
    }
    const agyGroups = (account: Account) => account.provider === "agy"
      ? account.quotas.filter(quota => quota.quotaAggregate && quota.quotaGroupId && quota.window)
      : []
    const agyLabel = (quota: Quota) => `${quota.quotaGroupId === "gemini" ? "Gemini" : quota.quotaGroupId === "claude_gpt" ? "Claude/GPT" : quota.quotaGroupId} · ${quota.window === "weekly" ? "weekly" : quota.window === "session" ? "session" : quota.window}`
    const quotaRow = (label: string, quota: Quota | undefined, labelWidth: number) => {
      const value = percent(quota)
      const width = Math.max(1, contentWidth() - labelWidth - 8)
      const bar = quota && !quota.unlimited && quota.remaining !== null ? shaded(quota.remaining, width) : "░".repeat(width)
      return `${truncate(label, labelWidth).padEnd(labelWidth)} ${bar} ${value.padStart(6)}`
    }
    const summaryBar = (account: Account) => {
      const summary = quotaSummary(account.quotas)
      return compactBar(summary.remaining, summary.unlimited)
    }
    const bar = (remaining: number | null, unlimited = false) => {
      if (unlimited) return <text>∞</text>
      if (remaining === null) return <text>?</text>
      return <text>{shaded(remaining, 10)} {remaining}%</text>
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
        <Show when={expanded()} fallback={<box flexDirection="column" flexShrink={0} onMouseUp={() => setExpanded(true)}>
          <For each={summaries().length ? summaries() : [{ provider: "—", windows: ["—", "—"] }]}>{(summary, index) => <text flexShrink={0} wrapMode="none" fg={ctx.theme.text.action.primary.base}><strong>{index() ? "    " : "▶ ⚙️"} <span style={{ fg: ctx.theme.text.muted }}>·</span> {truncate(summary.provider, Math.max(1, sidebarWidth() - 21))}<For each={summary.windows}>{window => <> <span style={{ fg: ctx.theme.text.muted }}>·</span> {window}</>}</For></strong></text>}</For>
          <Show when={state().status !== "ready"}><text fg={ctx.theme.text.muted}>· {state().status}</text></Show>
        </box>}><text flexShrink={0} onMouseUp={() => setExpanded(false)}><strong>▼ ⚙️ Quota</strong><span style={{ fg: ctx.theme.text.muted }}> · Updated {updated()}</span><Show when={state().status !== "ready"}><span style={{ fg: ctx.theme.text.muted }}> · {state().status}</span></Show></text></Show>
        <Show when={expanded()}>
        <For each={groups()}>{(group, groupIndex) => <box width="100%" flexDirection="column" flexShrink={0} paddingTop={groupIndex() ? 2 : 0}>
          <text height={1} flexShrink={0} fg={ctx.theme.text.action.primary.base}><strong>{group.provider.toUpperCase()}</strong></text>
          <Show when={percentsOnly}>
            <text wrapMode="none" fg={ctx.theme.text.muted}>{tableHeader(group.accounts, group.provider === "agy", sidebarWidth())}</text>
          </Show>
          <Show when={percentsOnly} fallback={<>
          <For each={group.accounts}>{(account, accountIndex) => <box width="100%" flexShrink={0} flexDirection="column">
              <Show when={accountIndex() > 0}><text fg={ctx.theme.text.muted}>{"─".repeat(sidebarWidth())}</text></Show>
              <text wrapMode="none">{truncate(`#${accountIndex() + 1}  ${maskAccountName(accountName(account))}`, sidebarWidth())}</text>
              <box flexDirection="column" paddingLeft={2}>
              <Show when={agyGroups(account).length} fallback={<Show when={hasWindows(account)} fallback={<>
                <text wrapMode="none">{truncate(summarizeQuotas(account.quotas), contentWidth())}</text>
                <text wrapMode="none">{summaryBar(account)}</text>
              </>}>
                <For each={(["5h", "7d"] as const)}>{label => <Show when={label !== "5h" || account.quotas.some(item => windowType(item) === label)}><text wrapMode="none"><span style={{ fg: ctx.theme.text.muted }}>{label}</span>{quotaRow(label, account.quotas.find(item => windowType(item) === label), 2).slice(2)}</text></Show>}</For>
              </Show>}>
                <For each={agyGroups(account)}>{quota => <text wrapMode="none">{quotaRow(agyLabel(quota).replace(" · ", " "), quota, Math.min(20, Math.max(10, contentWidth() - 12)))}</text>}</For>
              </Show>
              </box>
          </box>}</For>
          </>}>
            <For each={group.accounts}>{(account, accountIndex) => <box width="100%" flexShrink={0} flexDirection="column">
              <Show when={accountIndex() > 0}><text fg={ctx.theme.text.muted}>{"─".repeat(sidebarWidth())}</text></Show>
              <text wrapMode="none">{agyGroups(account).length ? truncate(`#${accountIndex() + 1}  ${maskAccountName(accountName(account))}`, sidebarWidth()) : tableRow(account, accountIndex(), group.provider === "agy" || groupHas5h(group.accounts), group.provider === "agy", numberWidth(group.accounts), sidebarWidth())}</text>
              <Show when={agyGroups(account).length} fallback={<Show when={!hasWindows(account)}><text wrapMode="none">{truncate(`   ${summarizeQuotas(account.quotas)}`, sidebarWidth())}</text></Show>}>
                <For each={agyGroups(account)}>{quota => <text wrapMode="none">{truncate(`   ${agyLabel(quota)}: ${percent(quota)}`, sidebarWidth())}</text>}</For>
              </Show>
            </box>}</For>
          </Show>
        </box>}</For>
        <text>/omni-quota — details</text>
        </Show>
      </box>},
    })

    const removePanel = ctx.ui.slot({
      append: "session.panel",
      render: input => <Show when={input.name === "omni-quota"}>
        <box flexDirection="column" height="100%" backgroundColor={ctx.theme.background.base}>
          <text flexShrink={0}><strong>{`OmniRoute: ${state().status}`}</strong>{" · /omni-quota-refresh"}</text>
          <text flexShrink={0} onMouseUp={() => ctx.ui.panel.close()}>Esc Back</text>
          <text flexShrink={0}>Cache · no routing guarantee</text>
          <Show when={state().updatedAt}>{time => <text flexShrink={0}>{`Received by plugin: ${new Date(time()).toLocaleString()}`}</text>}</Show>
          <scrollbox flexGrow={1} flexShrink={1}>
            <For each={groups()}>{group => <box flexDirection="column" paddingTop={1}>
              <text><strong>{group.provider}</strong></text>
              <For each={group.accounts}>{account => <box flexDirection="column" paddingLeft={1}>
              <text><strong>{accountName(account)} {account.plan}</strong></text>
              <For each={account.quotas}>{quota => <box flexDirection="column">
                <text>{quota.name}: remaining</text>
                 {percentsOnly ? <text>{percent(quota)}</text> : bar(quota.remaining, quota.unlimited)}
                <text>Used {quota.used ?? "?"} / {quota.total ?? "?"}</text>
                <text>Reset: {reset(quota.resetAt)}</text>
              </box>}</For>
              </box>}</For>
            </box>}</For>
          </scrollbox>
        </box>
      </Show>,
    })
    ctx.keymap.layer(() => ({ mode: "global", enabled: ctx.ui.panel.current()?.name === "omni-quota", commands: [
      { bind: "escape", run: () => ctx.ui.panel.close() },
    ] }))
    ctx.keymap.layer(() => ({ mode: "global", commands: [
      { id: "omni-quota.open", title: "OmniRoute: quotas", palette: true, slash: { name: "omni-quota" }, run: () => {
        if (!ctx.ui.panel.open("omni-quota")) ctx.ui.toast.show({ message: "Open a session to view quotas", variant: "info" })
      } },
      { id: "omni-quota.refresh", title: "OmniRoute: refresh quotas", palette: true, slash: { name: "omni-quota-refresh" }, run: () => { void poller.refreshManual().then(result => {
        if (result === "stopped") return
        const messages = { success: "Provider limits refresh completed; cache read requested", partial: "Some provider limits failed to refresh", auth: "Refresh requires a management token with manage or admin scope", error: "Provider limits refresh failed", timeout: "Provider limits refresh timed out; server may still be working", busy: "Provider limits refresh already in progress" }
        ctx.ui.toast.show({ message: messages[result], variant: result === "success" ? "success" : "warning" })
      }) } },
    ] }))
    return () => { poller.stop(); removeSidebar(); removePanel() }
  },
})
