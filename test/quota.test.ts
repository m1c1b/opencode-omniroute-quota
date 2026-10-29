import { describe, expect, test } from "bun:test"
import { remainingByWindow, fetchQuotas, groupAccounts, parseLabels, parseResponse, quotaSummary, summarizeQuotas, type Quota } from "../src/quota"

test("window summary sums actual usage and excludes ineligible quotas", () => {
  const accounts = parseResponse({ allowed: true, providers: [
    { connectionId: "a", provider: "agy", quotas: { one: { quotaAggregate: true, windowSeconds: 604800, used: 100, total: 100, remainingPercentage: 100 }, model: { windowSeconds: 604800, used: 0, total: 1000 }, weekly: { quotaAggregate: true, used: 0, total: 1000 } } },
    { connectionId: "b", provider: "codex", quotas: { weekly: { windowSeconds: 604800, used: 0, total: 1000, remainingPercentage: 0 }, session: { windowSeconds: 18000, used: 100, total: 100 } } },
    { connectionId: "c", provider: "codex", quotas: { weekly: { windowSeconds: 604800, unlimited: true, used: 100, total: 100 }, session: { windowSeconds: 18000, remaining: 100, total: 100 }, zero: { windowSeconds: 18000, used: 0, total: 0 }, invalid: { windowSeconds: 18000, used: Infinity, total: 100 } } },
  ] })
  expect(remainingByWindow(accounts)).toEqual({ "5h": 0, "7d": 1000 / 1100 * 100 })
  expect(remainingByWindow([])).toEqual({ "5h": null, "7d": null })
  accounts[1].quotas[0].used = NaN
  expect(remainingByWindow(accounts)["7d"]).toBe(0)
  accounts[0].quotas[0].used = 0
  expect(remainingByWindow(accounts)["7d"]).toBe(100)
  accounts[0].quotas[0].used = -1
  expect(remainingByWindow(accounts)["7d"]).toBe(100)
  accounts[0].quotas[0].used = 101
  expect(remainingByWindow(accounts)["7d"]).toBe(0)
  expect(remainingByWindow([accounts[2]])).toEqual({ "5h": null, "7d": null })
})

test("metadata keeps only valid email local parts", () => {
  expect([...parseLabels({ connections: [{ id: "a", email: "alice@example.test", apiKey: "secret" }, { id: "b", email: "invalid" }, { id: "c", email: "@example.test" }] })]).toEqual([["a", "alice"]])
  expect(parseLabels({ connections: null }).size).toBe(0)
})

test("preserves raw quota keys and window duration", () => {
  const [account] = parseResponse({ allowed: true, providers: [{ connectionId: "a", provider: "codex", quotas: { session: { displayName: "Weekly", windowSeconds: 604800 } } }] })
  expect(account.quotas[0]).toMatchObject({ key: "session", name: "Weekly", windowSeconds: 604800 })
})

test("preserves weekly-only quotas and distinguishes unknown and exhausted 5h quotas", () => {
  const accounts = parseResponse({ allowed: true, providers: [
    { connectionId: "a", provider: "codex", quotas: { weekly: { windowSeconds: 604800, remainingPercentage: 80 } } },
    { connectionId: "b", provider: "codex", quotas: { session: { windowSeconds: 18000, remainingPercentage: 0 } } },
    { connectionId: "c", provider: "codex", quotas: { session: { windowSeconds: 18000, remainingPercentage: null } } },
  ] })
  expect(accounts[0].quotas.map(q => [q.windowSeconds, q.remaining])).toEqual([[604800, 80]])
  expect(accounts[1].quotas.map(q => [q.windowSeconds, q.remaining])).toEqual([[18000, 0]])
  expect(accounts[2].quotas.map(q => [q.windowSeconds, q.remaining])).toEqual([[18000, null]])
})

test("preserves explicit AGY aggregate metadata and individual models", () => {
  const [account] = parseResponse({ allowed: true, providers: [{ connectionId: "a", provider: "agy", quotas: {
    gemini_weekly: { quotaGroupId: "gemini", quotaAggregate: true, window: "weekly", remainingPercentage: 25 },
    "gemini-model": { remainingPercentage: 12 },
  } }] })
  expect(account.quotas).toHaveLength(2)
  expect(account.quotas[0]).toMatchObject({ quotaGroupId: "gemini", quotaAggregate: true, window: "weekly", remaining: 25 })
  expect(account.quotas[1].quotaAggregate).toBe(false)
})

test("groups accounts by provider without losing order", () => {
  const accounts = ["a", "b", "a"].map((provider, i) => ({ id: String(i), provider, plan: "", quotas: [] }))
  expect(groupAccounts(accounts).map(group => [group.provider, group.accounts.map(account => account.id)])).toEqual([["a", ["0", "2"]], ["b", ["1"]]])
})

test("preserves API order across interleaved providers and accounts", () => {
  const accounts = parseResponse({ allowed: true, providers: [
    { connectionId: "z", provider: "agy", quotas: {} },
    { connectionId: "y", provider: "codex", quotas: {} },
    { connectionId: "a", provider: "agy", quotas: {} },
    { connectionId: "b", provider: "codex", quotas: {} },
  ] })
  expect(accounts.map(account => account.id)).toEqual(["z", "y", "a", "b"])
  expect(groupAccounts(accounts).map(group => [group.provider, group.accounts.map(account => account.id)])).toEqual([
    ["agy", ["z", "a"]],
    ["codex", ["y", "b"]],
  ])
})

const provider = (connectionId: string) => ({
  connectionId, provider: "codex", plan: "pro", quotas: {
    session: { used: 12, total: 100, remaining: 88, displayName: "Weekly", resetAt: "2026-01-01T00:00:00Z" },
    model: { used: 1000, total: 1000, remainingPercentage: 0, fractionReported: true },
  },
})

describe("OmniRoute response", () => {
  test("uses all accounts in API order and handles quota variants", () => {
    const accounts = parseResponse({ allowed: true, provider: provider("ignored"), providers: [provider("b"), provider("a")] })
    expect(accounts.map(a => a.id)).toEqual(["b", "a"])
    expect(accounts[0]?.quotas[0]).toMatchObject({ name: "Weekly", remaining: 88, resetAt: "2026-01-01T00:00:00Z" })
    expect(accounts[0]?.quotas[1]?.remaining).toBe(0)
  })

  test("supports fallback and rejects invalid bodies", () => {
    expect(parseResponse({ allowed: true, provider: provider("a") })).toHaveLength(1)
    expect(() => parseResponse({ allowed: false, providers: [] })).toThrow()
    expect(() => parseResponse({ allowed: true, providers: [{}] })).toThrow()
    expect(parseResponse({ allowed: true, provider: provider("a"), providers: [] })).toEqual([])
  })

  test("calculates missing percentages and handles zero totals and unlimited", () => {
    const p = provider("a")
    const quotas = { used: { used: 25, total: 100 }, zero: { used: 0, total: 0 }, unlimited: { unlimited: true } }
    const result = parseResponse({ allowed: true, provider: { ...p, quotas } })[0]!.quotas
    expect(result.map(q => [q.remaining, q.unlimited])).toEqual([[75, false], [null, false], [null, true]])
  })

  test("summarizes known, unknown and unlimited windows", () => {
    const q = (remaining: number | null, unlimited = false): Quota => ({ name: "", remaining, unlimited, used: null, total: null, resetAt: null })
    expect(summarizeQuotas([])).toBe("0 quotas")
    expect(summarizeQuotas([q(null, true)])).toBe("1 quota · min. ∞")
    expect(summarizeQuotas([q(null), q(null, true)])).toBe("2 quotas · min. ?")
    expect(summarizeQuotas([q(50), q(10), q(null), q(null, true)])).toBe("4 quotas · min. 10% + ?")
    expect(quotaSummary([])).toEqual({ count: 0, remaining: null, unlimited: false, hasUnknown: false })
    expect(quotaSummary([q(null, true)])).toEqual({ count: 1, remaining: null, unlimited: true, hasUnknown: false })
    expect(quotaSummary([q(50), q(10), q(null), q(null, true)])).toEqual({ count: 4, remaining: 10, unlimited: false, hasUnknown: true })
  })

  test("sends bearer to expected endpoint and rejects redirects", async () => {
    const server = Bun.serve({ port: 0, fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer test-key")
      if (new URL(request.url).pathname === "/api/providers") return Response.json({ connections: [{ id: "a", email: "alice@example.test" }] })
      expect(new URL(request.url).pathname).toBe("/api/usage/om-usage")
      expect(new URL(request.url).searchParams.get("format")).toBe("json")
      return Response.json({ allowed: true, providers: [provider("a")] })
    } })
    try {
      expect((await fetchQuotas(server.url.href, "test-key", new AbortController().signal))[0].label).toBe("alice")
    } finally { server.stop() }
  })

  test("keeps quotas when metadata is forbidden", async () => {
    const server = Bun.serve({ port: 0, fetch(request) {
      return new URL(request.url).pathname === "/api/providers" ? new Response(null, { status: 403 }) : Response.json({ allowed: true, providers: [provider("a")] })
    } })
    try { expect((await fetchQuotas(server.url.href, "test-key", new AbortController().signal))[0].label).toBeUndefined() }
    finally { server.stop(true) }
  })

  test("does not follow redirects or send credentials to redirect target", async () => {
    let targetCalls = 0
    const target = Bun.serve({ port: 0, fetch() { targetCalls++; return new Response() } })
    const server = Bun.serve({ port: 0, fetch() { return Response.redirect(target.url.href) } })
    try {
      await expect(fetchQuotas(server.url.href, "test-secret", new AbortController().signal)).rejects.toThrow()
      expect(targetCalls).toBe(0)
    } finally { server.stop(true); target.stop(true) }
  })

  test.each([401, 403])("does not expose HTTP %i response details", async status => {
    const server = Bun.serve({ port: 0, fetch() { return new Response("test-secret sensitive-account", { status }) } })
    try {
      try { await fetchQuotas(server.url.href, "test-secret", new AbortController().signal); throw new Error("expected failure") }
      catch (error) { expect(String(error)).toBe("Error: request failed") }
    } finally { server.stop(true) }
  })
})
