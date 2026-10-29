import { expect, test } from "bun:test"
import { createPoller, type State } from "../src/poller"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test("metadata timeout publishes fresh usage on initial and subsequent reads", async () => {
  let usage = 0
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/api/providers") {
      await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }))
      return new Response()
    }
    usage++
    return Response.json({ allowed: true, providers: [{ connectionId: String(usage), provider: "codex", quotas: {} }] })
  } })
  const ready = deferred()
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 50 }, state => { states.push(state); ready.resolve() })
  try {
    await ready.promise
    expect(states.at(-1)?.status).toBe("ready")
    expect(states.at(-1)?.accounts?.[0].id).toBe("1")
    const first = states.at(-1)?.updatedAt
    await poller.refresh()
    expect(states.at(-1)?.status).toBe("ready")
    expect(states.at(-1)?.accounts?.[0].id).toBe("2")
    expect(states.at(-1)!.updatedAt!).toBeGreaterThan(first!)
  } finally { poller.stop(); server.stop(true) }
})

test.each(["manual", "stop"])("%s cancels pending metadata without publishing it", async action => {
  const started = deferred()
  const release = deferred()
  const post = deferred()
  const states: State[] = []
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === "POST") { post.resolve(); return Response.json({ failed: 0 }) }
    if (new URL(request.url).pathname === "/api/providers") {
      started.resolve()
      await release.promise
      return Response.json({ connections: [] })
    }
    return Response.json({ allowed: true, providers: [{ connectionId: "a", provider: "codex", quotas: {} }] })
  } })
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 1000 }, state => states.push(state))
  try {
    await started.promise
    if (action === "stop") {
      poller.stop()
      release.resolve()
      await poller.refresh()
      expect(states).toHaveLength(0)
    } else {
      const result = poller.refreshManual()
      await post.promise
      expect(states).toHaveLength(0)
      release.resolve()
      expect(await result).toBe("success")
      expect(states.map(state => state.status)).toEqual(["ready"])
    }
  } finally { release.resolve(); poller.stop(); server.stop(true) }
})

test("manual refresh posts before reading cache and prevents duplicate posts", async () => {
  const requests: string[] = []
  const release = deferred()
  const started = deferred()
  const ready = deferred()
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(request.method)
    expect(request.headers.get("authorization")).toBe("Bearer test")
    if (request.method === "POST") {
      expect(await request.text()).toBe("")
      started.resolve()
      await release.promise
      return Response.json({ failed: 0 })
    }
    return Response.json({ allowed: true, providers: [] })
  } })
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 1000 }, () => ready.resolve())
  try {
    await ready.promise
    expect(requests.every(method => method === "GET")).toBe(true)
    requests.length = 0
    const result = poller.refreshManual()
    await started.promise
    expect(await poller.refreshManual()).toBe("busy")
    expect(requests).toEqual(["POST"])
    release.resolve()
    expect(await result).toBe("success")
    expect(requests.slice(0, 2)).toEqual(["POST", "GET"])
  } finally { release.resolve(); poller.stop(); server.stop(true) }
})

test("manual refresh reports safe authorization and partial failures", async () => {
  let status = 401
  const server = Bun.serve({ port: 0, fetch(request) {
    if (request.method === "POST") return status === 200 ? Response.json({ failed: 1, errors: { secret: "private" } }) : new Response("secret", { status })
    return Response.json({ allowed: true, providers: [] })
  } })
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 1000 }, () => {})
  try {
    for (status of [401, 403]) expect(await poller.refreshManual()).toBe("auth")
    status = 200
    expect(await poller.refreshManual()).toBe("partial")
  } finally { poller.stop(); server.stop(true) }
})

test("stopping during manual refresh aborts without further publications", async () => {
  const started = deferred()
  const release = deferred()
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === "POST") {
      started.resolve()
      await release.promise
      return Response.json({ failed: 0 })
    }
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 1000 }, state => states.push(state))
  try {
    const result = poller.refreshManual()
    await started.promise
    poller.stop()
    const count = states.length
    release.resolve()
    expect(await result).toBe("stopped")
    expect(states).toHaveLength(count)
  } finally { release.resolve(); poller.stop(); server.stop(true) }
})

test("prevents overlap, preserves stale data and stops", async () => {
  let requests = 0
  let fail = false
  const release = deferred()
  const started = deferred()
  const ready = deferred()
  const server = Bun.serve({ port: 0, async fetch() {
    requests++
    if (fail) return new Response("failure", { status: 500 })
    started.resolve()
    await release.promise
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 5000 }, s => { states.push(s); ready.resolve() })
  try {
    await started.promise
    await poller.refresh()
    expect(requests).toBe(1)
    release.resolve()
    await ready.promise
    expect(states.at(-1)?.status).toBe("ready")
    const updatedAt = states.at(-1)?.updatedAt
    expect(updatedAt).not.toBeNull()
    fail = true
    await poller.refresh()
    expect(states.at(-1)?.status).toBe("stale")
    expect(states.at(-1)?.updatedAt).toBe(updatedAt)
    expect(states.at(-1)?.accounts).toEqual([])
    poller.stop()
    await poller.refresh()
    expect(requests).toBe(2)
  } finally { release.resolve(); poller.stop(); server.stop(true) }
})

test("missing credentials is unavailable without requests", async () => {
  const states: State[] = []
  const poller = createPoller({ baseUrl: "", apiKey: "", interval: 60_000, timeout: 1000 }, s => states.push(s))
  expect(states.at(-1)?.status).toBe("unavailable")
  poller.stop()
})

test("timeout marks previous data stale and permits a later refresh", async () => {
  let requests = 0
  const ready = deferred()
  const server = Bun.serve({ port: 0, async fetch() {
    requests++
    if (requests === 1) return Response.json({ allowed: true, providers: [] })
    await Bun.sleep(150)
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 50 }, s => { states.push(s); ready.resolve() })
  try {
    await ready.promise
    expect(states.at(-1)?.status).toBe("ready")
    await poller.refresh()
    expect(states.at(-1)?.status).toBe("stale")
    expect(states.at(-1)?.accounts).toEqual([])
    await poller.refresh()
    expect(requests).toBe(3)
  } finally { poller.stop(); server.stop(true) }
})

test("stop aborts pending request and suppresses callbacks", async () => {
  const started = deferred()
  const release = deferred()
  const server = Bun.serve({ port: 0, async fetch() {
    started.resolve()
    await release.promise
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 500 }, s => states.push(s))
  try {
    await started.promise
    const result = poller.refreshManual()
    poller.stop()
    release.resolve()
    expect(await result).toBe("stopped")
    expect(states).toEqual([])
    await poller.refresh()
    expect(states).toEqual([])
  } finally { release.resolve(); poller.stop(); server.stop(true) }
})

test("timeout aborts pending request and keeps previous data stale", async () => {
  let calls = 0
  const ready = deferred()
  const server = Bun.serve({ port: 0, fetch() {
    calls++
    if (calls === 1) return Response.json({ allowed: true, providers: [] })
    return new Promise<Response>(() => {})
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 50 }, s => { states.push(s); ready.resolve() })
  try {
    await ready.promise
    expect(states.at(-1)?.status).toBe("ready")
    await poller.refresh()
    expect(states.at(-1)?.status).toBe("stale")
    expect(states.at(-1)?.accounts).toEqual([])
  } finally { poller.stop(); server.stop(true) }
})

test("stop aborts pending request without publishing after stop", async () => {
  let started!: () => void
  const requestStarted = new Promise<void>(resolve => { started = resolve })
  const server = Bun.serve({ port: 0, fetch() { started(); return new Promise<Response>(() => {}) } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 500 }, s => states.push(s))
  try {
    await requestStarted
    await poller.refresh()
    const result = poller.refreshManual()
    poller.stop()
    expect(await result).toBe("stopped")
    expect(states).toEqual([])
  } finally { poller.stop(); server.stop(true) }
})
