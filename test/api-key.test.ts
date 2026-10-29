import { expect, test } from "bun:test"
import { resolveApiKey } from "../src/api-key"
import { createPoller, type State } from "../src/poller"

test("explicit key takes precedence over the environment fallback", () => {
  const env = { OMNIROUTE_API_KEY: "fallback" }
  expect(resolveApiKey("explicit", env)).toBe("explicit")
  expect(resolveApiKey(undefined, env)).toBe("fallback")
  expect(resolveApiKey("", env)).toBe("")
})

test("resolves env references and rejects missing, empty or unresolved values", () => {
  const env = { OMNIROUTE_API_KEY: "fallback", OTHER: "value", EMPTY: "  ", NESTED: "{env:OTHER}" }
  expect(resolveApiKey("{env:OTHER}", env)).toBe("value")
  expect(resolveApiKey("{env:MISSING}", env)).toBe("")
  expect(resolveApiKey("{env:EMPTY}", env)).toBe("")
  expect(resolveApiKey("{env:NESTED}", env)).toBe("")
  expect(resolveApiKey("{env:OTHER", env)).toBe("")
  expect(resolveApiKey(undefined, { OMNIROUTE_API_KEY: "{env:MISSING}" })).toBe("")
})

test("unresolved reference never sends an HTTP request", async () => {
  let requests = 0
  const server = Bun.serve({ port: 0, fetch() { requests++; return new Response() } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: resolveApiKey("{env:MISSING}", {}), interval: 60_000, timeout: 1000 }, state => states.push(state))
  try {
    await poller.refresh()
    expect(requests).toBe(0)
    expect(states.at(-1)?.status).toBe("unavailable")
  } finally { poller.stop(); server.stop(true) }
})
