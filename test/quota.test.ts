import { describe, expect, test } from "bun:test"
import { fetchQuotas, parseResponse, summarizeQuotas, type Quota } from "../src/quota"

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
      expect(new URL(request.url).pathname).toBe("/api/usage/om-usage")
      expect(new URL(request.url).searchParams.get("format")).toBe("json")
      expect(request.headers.get("authorization")).toBe("Bearer test-key")
      return Response.json({ allowed: true, providers: [provider("a")] })
    } })
    try {
      expect(await fetchQuotas(server.url.href, "test-key", new AbortController().signal)).toHaveLength(1)
    } finally { server.stop() }
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
