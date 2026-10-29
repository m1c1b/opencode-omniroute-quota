import { describe, expect, test } from "bun:test"
import { fetchQuotas, groupAccounts, parseLabels, parseResponse, summarizeQuotas, type Quota } from "../src/quota"

test("metadata keeps only valid email local parts", () => {
  expect([...parseLabels({ connections: [{ id: "a", email: "alice@example.test", apiKey: "secret" }, { id: "b", email: "invalid" }, { id: "c", email: "@example.test" }] })]).toEqual([["a", "alice"]])
  expect(parseLabels({ connections: null }).size).toBe(0)
})

test("groups accounts by provider without losing order", () => {
  const accounts = ["a", "b", "a"].map((provider, i) => ({ id: String(i), provider, plan: "", quotas: [] }))
  expect(groupAccounts(accounts).map(group => [group.provider, group.accounts.map(account => account.id)])).toEqual([["a", ["0", "2"]], ["b", ["1"]]])
})

const provider = (connectionId: string) => ({
  connectionId, provider: "codex", plan: "pro", quotas: {
    session: { used: 12, total: 100, remaining: 88, displayName: "Weekly", resetAt: "2026-01-01T00:00:00Z" },
    model: { used: 1000, total: 1000, remainingPercentage: 0, fractionReported: true },
  },
})

describe("OmniRoute response", () => {
  test("uses all accounts, sorts them and handles quota variants", () => {
    const accounts = parseResponse({ allowed: true, provider: provider("ignored"), providers: [provider("b"), provider("a")] })
    expect(accounts.map(a => a.id)).toEqual(["a", "b"])
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
    expect(summarizeQuotas([])).toBe("0 квот")
    expect(summarizeQuotas([q(null, true)])).toBe("1 квот · мин. ∞")
    expect(summarizeQuotas([q(null), q(null, true)])).toBe("2 квот · мин. ?")
    expect(summarizeQuotas([q(50), q(10), q(null), q(null, true)])).toBe("4 квот · мин. 10% + ?")
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
