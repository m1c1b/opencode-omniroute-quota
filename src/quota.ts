export interface Quota {
  name: string
  key?: string
  windowSeconds?: number | null
  quotaGroupId?: string
  quotaAggregate?: boolean
  window?: string
  remaining: number | null
  used: number | null
  total: number | null
  resetAt: string | null
  unlimited: boolean
}

export interface Account {
  id: string
  label?: string
  provider: string
  plan: string
  quotas: Quota[]
}

export function windowType(quota: Quota): "5h" | "7d" | null {
  if (quota.windowSeconds === 18000) return "5h"
  if (quota.windowSeconds === 604800) return "7d"
  if (quota.windowSeconds != null) return null
  const name = `${quota.key ?? ""} ${quota.name}`.toLowerCase()
  if (/\b(weekly|week|7d|7 days?)\b/.test(name)) return "7d"
  if (/\b(5h|5 hours?)\b/.test(name)) return "5h"
  return null
}

function eligibleWindow(account: Account, quota: Quota, window: "5h" | "7d"): boolean {
  if (account.provider === "agy" && (!quota.quotaAggregate || quota.windowSeconds == null)) return false
  if (windowType(quota) !== window || quota.unlimited) return false
  return quota.used !== null && quota.total !== null && Number.isFinite(quota.used) && Number.isFinite(quota.total) && quota.total > 0
}

export function remainingByWindow(accounts: Account[]): { "5h": number | null; "7d": number | null } {
  const windowAverage = (window: "5h" | "7d") => {
    let used = 0
    let total = 0
    for (const account of accounts) for (const quota of account.quotas) {
      if (!eligibleWindow(account, quota, window)) continue
      used += quota.used!
      total += quota.total!
    }
    return total > 0 ? Math.max(0, Math.min(100, (total - used) / total * 100)) : null
  }
  return { "5h": windowAverage("5h"), "7d": windowAverage("7d") }
}

export function quotaSummary(quotas: Quota[]) {
  const limited = quotas.filter(quota => !quota.unlimited)
  const known = limited.flatMap(quota => quota.remaining === null ? [] : [quota.remaining])
  return {
    count: quotas.length,
    remaining: known.length ? Math.min(...known) : null,
    unlimited: quotas.length > 0 && !limited.length,
    hasUnknown: known.length < limited.length,
  }
}

export function summarizeQuotas(quotas: Quota[]): string {
  const summary = quotaSummary(quotas)
  if (!summary.count) return "0 quotas"
  const worst = summary.remaining !== null ? `${summary.remaining}%` : summary.unlimited ? "∞" : "?"
  const unknown = summary.hasUnknown && summary.remaining !== null ? " + ?" : ""
  return `${summary.count} ${summary.count === 1 ? "quota" : "quotas"} · min. ${worst}${unknown}`
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const text = (value: unknown): string => typeof value === "string" ? value : ""

function parseAccount(value: unknown): Account {
  const item = record(value)
  const quotas = record(item?.quotas)
  if (!item || !text(item.connectionId) || !text(item.provider) || !quotas) throw new Error("invalid response")
  return {
    id: text(item.connectionId),
    provider: text(item.provider),
    plan: text(item.plan),
    quotas: Object.entries(quotas).map(([name, raw]) => {
      const quota = record(raw)
      if (!quota) throw new Error("invalid response")
      return {
        name: text(quota.displayName) || name,
        key: name,
        windowSeconds: number(quota.windowSeconds),
        quotaGroupId: text(quota.quotaGroupId),
        quotaAggregate: quota.quotaAggregate === true,
        window: text(quota.window),
        remaining: percentage(quota),
        used: number(quota.used),
        total: number(quota.total),
        resetAt: text(quota.resetAt) || null,
        unlimited: quota.unlimited === true,
      }
    }),
  }
}

function percentage(quota: Record<string, unknown>): number | null {
  const reported = number(quota.remainingPercentage)
  if (reported !== null) return reported
  const total = number(quota.total)
  const remaining = number(quota.remaining)
  const used = number(quota.used)
  if (total === null || total <= 0) return null
  if (remaining !== null) return remaining / total * 100
  return used === null ? null : (total - used) / total * 100
}

export function parseResponse(value: unknown): Account[] {
  const body = record(value)
  if (!body || body.allowed !== true) throw new Error("invalid response")
  if (Array.isArray(body.providers)) return body.providers.map(parseAccount).sort((a, b) => a.id.localeCompare(b.id))
  if (body.provider) return [parseAccount(body.provider)]
  throw new Error("invalid response")
}

export function parseLabels(value: unknown): Map<string, string> {
  const labels = new Map<string, string>()
  const connections = record(value)?.connections
  if (!Array.isArray(connections)) return labels
  for (const raw of connections) {
    const item = record(raw)
    const id = text(item?.id)
    const email = text(item?.email)
    const at = email.indexOf("@")
    if (id && at > 0 && at < email.length - 1) labels.set(id, email.slice(0, at))
  }
  return labels
}

export function groupAccounts(accounts: Account[]): { provider: string; accounts: Account[] }[] {
  const groups = new Map<string, Account[]>()
  for (const account of accounts) {
    const group = groups.get(account.provider) ?? []
    group.push(account)
    groups.set(account.provider, group)
  }
  return [...groups].map(([provider, accounts]) => ({ provider, accounts }))
}

function rethrowCancellation(signal: AbortSignal, error: unknown): void {
  if (signal.aborted && signal.reason?.name !== "TimeoutError") throw error
}

export async function fetchQuotas(baseUrl: string, apiKey: string, signal: AbortSignal): Promise<Account[]> {
  const base = new URL(baseUrl)
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("invalid URL")
  const url = new URL("/api/usage/om-usage?format=json", base)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal, redirect: "error" })
  if (!response.ok) throw new Error("request failed")
  const accounts = parseResponse(await response.json())
  if (!accounts.length) return accounts
  try {
    const metadata = await fetch(new URL("/api/providers", base), { headers: { Authorization: `Bearer ${apiKey}` }, signal, redirect: "error" })
    if (metadata.ok) {
      const labels = parseLabels(await metadata.json())
      for (const account of accounts) account.label = labels.get(account.id)
    }
  } catch (error) {
    rethrowCancellation(signal, error)
  }
  return accounts
}

function refreshResult(body: Record<string, unknown> | null): "success" | "partial" | "error" {
  if (typeof body?.failed !== "number" || !Number.isInteger(body.failed) || body.failed < 0) return "error"
  return body.failed > 0 ? "partial" : "success"
}

export async function refreshProviderLimits(baseUrl: string, apiKey: string, signal: AbortSignal): Promise<"success" | "partial" | "auth" | "error"> {
  const base = new URL(baseUrl)
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("invalid URL")
  const response = await fetch(new URL("/api/usage/provider-limits", base), {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal,
  })
  if (response.status === 401 || response.status === 403) return "auth"
  if (!response.ok) return "error"
  return refreshResult(record(await response.json()))
}
