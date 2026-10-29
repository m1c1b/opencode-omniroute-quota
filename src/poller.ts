import { fetchQuotas, refreshProviderLimits, type Account } from "./quota"

export interface State {
  accounts: Account[] | null
  status: "loading" | "ready" | "stale" | "unavailable"
  updatedAt: number | null
}

export function createPoller(config: { baseUrl: string; apiKey: string; interval: number; timeout: number }, publish: (state: State) => void) {
  let state: State = { accounts: null, status: "loading", updatedAt: null }
  let active: AbortController | undefined
  let activePromise: Promise<void> | undefined
  const cancelled = new WeakSet<AbortController>()
  let stopped = false
  let manual = false
  const update = (next: State) => { state = next; publish(next) }
  const failed = () => update({ ...state, status: state.accounts ? "stale" : "unavailable" })

  async function readCacheRequest(): Promise<void> {
    if (stopped || active) return
    if (!config.apiKey || !config.baseUrl) {
      failed()
      return
    }
    const controller = new AbortController()
    active = controller
    const timeout = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), config.timeout)
    try {
      const accounts = await fetchQuotas(config.baseUrl, config.apiKey, controller.signal)
      if (!stopped && !cancelled.has(controller)) update({ accounts, status: "ready", updatedAt: Date.now() })
    } catch {
      if (!stopped && !cancelled.has(controller)) failed()
    } finally {
      clearTimeout(timeout)
      active = undefined
    }
  }

  function readCache(): Promise<void> {
    if (stopped || active) return Promise.resolve()
    const request = readCacheRequest()
    activePromise = request
    void request.finally(() => { if (activePromise === request) activePromise = undefined })
    return request
  }

  async function refresh(): Promise<void> {
    if (!manual) await readCache()
  }

  async function post(): Promise<"success" | "partial" | "auth" | "error" | "timeout"> {
    const controller = new AbortController()
    active = controller
    const timeout = setTimeout(() => controller.abort(), 300_000)
    try {
      return await refreshProviderLimits(config.baseUrl, config.apiKey, controller.signal)
    } catch {
      return controller.signal.aborted ? "timeout" : "error"
    } finally {
      clearTimeout(timeout)
      active = undefined
    }
  }

  async function runManual(): Promise<"success" | "partial" | "auth" | "error" | "timeout" | "stopped"> {
    if (active) {
      cancelled.add(active)
      active.abort()
      await activePromise
    }
    if (stopped) return "stopped"
    const result = await post()
    if (stopped) return "stopped"
    if (result === "success" || result === "partial") await readCache()
    return stopped ? "stopped" : result
  }

  const interval = setInterval(() => { void refresh() }, config.interval)
  void refresh()
  return {
    refresh,
    async refreshManual(): Promise<"success" | "partial" | "auth" | "error" | "timeout" | "busy" | "stopped"> {
      if (stopped) return "stopped"
      if (manual) return "busy"
      manual = true
      try {
        return await runManual()
      } finally { manual = false }
    },
    stop() { stopped = true; clearInterval(interval); active?.abort() },
  }
}
