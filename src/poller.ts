import { fetchQuotas, type Account } from "./quota"

export interface State {
  accounts: Account[] | null
  status: "loading" | "ready" | "stale" | "unavailable"
  updatedAt: number | null
}

export function createPoller(config: { baseUrl: string; apiKey: string; interval: number; timeout: number }, publish: (state: State) => void) {
  let state: State = { accounts: null, status: "loading", updatedAt: null }
  let active: AbortController | undefined
  let stopped = false
  const update = (next: State) => { state = next; publish(next) }
  const failed = () => update({ ...state, status: state.accounts ? "stale" : "unavailable" })

  async function refresh(): Promise<void> {
    if (stopped || active) return
    if (!config.apiKey || !config.baseUrl) {
      failed()
      return
    }
    const controller = new AbortController()
    active = controller
    const timeout = setTimeout(() => controller.abort(), config.timeout)
    try {
      const accounts = await fetchQuotas(config.baseUrl, config.apiKey, controller.signal)
      if (!stopped && !controller.signal.aborted) update({ accounts, status: "ready", updatedAt: Date.now() })
    } catch {
      if (!stopped) failed()
    } finally {
      clearTimeout(timeout)
      active = undefined
    }
  }

  const interval = setInterval(() => { void refresh() }, config.interval)
  void refresh()
  return {
    refresh,
    stop() { stopped = true; clearInterval(interval); active?.abort() },
  }
}
