import { expect, test } from "bun:test"
import { createPoller, type State } from "../src/poller"

test("prevents overlap, preserves stale data and stops", async () => {
  let requests = 0
  let fail = false
  let release: (() => void) | undefined
  const server = Bun.serve({ port: 0, async fetch() {
    requests++
    if (fail) return new Response("failure", { status: 500 })
    await new Promise<void>(resolve => { release = resolve })
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 5000 }, s => states.push(s))
  try {
    await Bun.sleep(20)
    await poller.refresh()
    expect(requests).toBe(1)
    release?.()
    await Bun.sleep(20)
    expect(states.at(-1)?.status).toBe("ready")
    fail = true
    await poller.refresh()
    expect(states.at(-1)?.status).toBe("stale")
    expect(states.at(-1)?.accounts).toEqual([])
    poller.stop()
    await poller.refresh()
    expect(requests).toBe(2)
  } finally { poller.stop(); server.stop(true) }
})

test("missing credentials is unavailable without requests", async () => {
  const states: State[] = []
  const poller = createPoller({ baseUrl: "", apiKey: "", interval: 60_000, timeout: 1000 }, s => states.push(s))
  expect(states.at(-1)?.status).toBe("unavailable")
  poller.stop()
})

test("timeout marks previous data stale and permits a later refresh", async () => {
  let requests = 0
  const server = Bun.serve({ port: 0, async fetch() {
    requests++
    if (requests === 1) return Response.json({ allowed: true, providers: [] })
    await Bun.sleep(150)
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 50 }, s => states.push(s))
  try {
    await Bun.sleep(20)
    expect(states.at(-1)?.status).toBe("ready")
    await poller.refresh()
    expect(states.at(-1)?.status).toBe("stale")
    expect(states.at(-1)?.accounts).toEqual([])
    await poller.refresh()
    expect(requests).toBe(3)
  } finally { poller.stop(); server.stop(true) }
})

test("stop aborts pending request and suppresses callbacks", async () => {
  let started!: () => void
  const received = new Promise<void>(resolve => { started = resolve })
  const server = Bun.serve({ port: 0, async fetch() {
    started()
    await Bun.sleep(100)
    return Response.json({ allowed: true, providers: [] })
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 500 }, s => states.push(s))
  try {
    await received
    poller.stop()
    await Bun.sleep(150)
    expect(states).toEqual([])
    await poller.refresh()
    expect(states).toEqual([])
  } finally { poller.stop(); server.stop(true) }
})

test("timeout aborts pending request and keeps previous data stale", async () => {
  let calls = 0
  const server = Bun.serve({ port: 0, fetch() {
    calls++
    if (calls === 1) return Response.json({ allowed: true, providers: [] })
    return new Promise<Response>(() => {})
  } })
  const states: State[] = []
  const poller = createPoller({ baseUrl: server.url.href, apiKey: "test", interval: 60_000, timeout: 50 }, s => states.push(s))
  try {
    await Bun.sleep(30)
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
    poller.stop()
    await Bun.sleep(50)
    expect(states).toEqual([])
  } finally { poller.stop(); server.stop(true) }
})
