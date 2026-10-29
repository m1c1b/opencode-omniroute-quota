export interface Quota {
  name: string
  key?: string
  windowSeconds?: number | null
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

export function summarizeQuotas(quotas: Quota[]): string {
  if (!quotas.length) return "0 квот"
  const limited = quotas.filter(quota => !quota.unlimited)
  const known = limited.flatMap(quota => quota.remaining === null ? [] : [quota.remaining])
  const worst = known.length ? `${Math.min(...known)}%` : limited.length ? "?" : "∞"
  const unknown = known.length < limited.length && known.length > 0 ? " + ?" : ""
  return `${quotas.length} квот · мин. ${worst}${unknown}`
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
  } catch { /* Metadata is optional. */ }
  return accounts
}
