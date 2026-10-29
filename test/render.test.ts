import { expect, test } from "bun:test"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { testRender } from "@opentui/solid"
import { BoxRenderable, RGBA, ScrollBoxRenderable, type Renderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"

test("panel renders and scrolls within its allocated dimensions", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  const file = Bun.file(`${import.meta.dir}/../dist/render-test.js`)
  await Bun.write(file, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-test.js", import.meta.url).href)).default
  const providers = Array.from({ length: 3 }, (_, i) => ({ connectionId: `account${i}`, provider: `provider${i === 1 ? 0 : i}`, plan: "pro", quotas: Object.fromEntries(Array.from({ length: 12 }, (_, j) => [`window${j}`, j === 0 ? { used: 10, total: 10 } : j === 1 ? { used: 5, total: 10 } : j === 2 ? { used: 0, total: 10 } : j === 3 ? {} : j === 4 ? { unlimited: true } : { used: 2, total: 10 }])) }))
  const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/api/providers" ? Response.json({ connections: providers.map((p, i) => ({ id: p.connectionId, email: `user${i}@example.test` })) }) : Response.json({ allowed: true, providers }) })
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  let panel: (input: { name: string }) => unknown = () => null
  let sidebar: (input: { name: string }) => unknown = () => null
  const context = { options: { baseUrl: server.url.href }, theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777" } }, ui: { slot: (claim: { append: string; render: typeof panel }) => { if (claim.append === "session.panel") panel = claim.render; if (claim.append === "sidebar.content") sidebar = claim.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Plugin.Context
  const stop = await plugin.setup(context)
  try {
    await Bun.sleep(50)
    for (const width of [32, 70]) {
      const view = await testRender(() => panel({ name: "omni-quota" }) as never, { width, height: 18 })
      try {
        await view.renderOnce()
        const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
        const nodes = walk(view.renderer.root)
        const scroll = nodes.find(node => node instanceof ScrollBoxRenderable) as ScrollBoxRenderable
        await view.renderOnce()
        const frame = view.captureCharFrame()
        const headers = nodes.slice(2, 5)
        expect(frame).toContain("OmniRoute: ready")
        expect(frame).toContain("Кеш OmniRoute · не гарантия")
        expect(frame).toContain("Получено плагином:")
        expect(frame).toContain("provider0")
        expect(frame).toContain("user0 pro")
        expect(frame).not.toContain("example.test")
        expect(frame).toContain("window0: осталось")
        expect(frame).toContain("░░░░░░░░░░ 0%")
        expect(frame).toContain("Использовано 10 / 10")
        expect(headers[1].y).toBe(headers[0].y + headers[0].height)
        expect(headers[2].y).toBe(headers[1].y + headers[1].height)
        expect(scroll.y).toBe(headers[2].y + headers[2].height)
        expect(scroll.y + scroll.height).toBe(18)
        expect(scroll.scrollHeight).toBeGreaterThan(scroll.height)
        expect((nodes[1] as BoxRenderable).backgroundColor).toEqual(RGBA.fromHex("#101010"))
        for (const node of nodes) {
          expect(node.x).toBeGreaterThanOrEqual(0)
          expect(node.x + node.width).toBeLessThanOrEqual(width)
        }
        scroll.scrollTo(4)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("█████░░░░░ 50%")
        expect(view.captureCharFrame()).toContain("██████████ 100%")
        scroll.scrollTo(12)
        await view.renderOnce()
        const middle = view.captureCharFrame()
        expect(middle).toMatch(/window3: осталось\s+\?(?!\s*\d+%)/)
        expect(middle).toMatch(/window4: осталось\s+∞(?!\s*\d+%)/)
        let allFrames = ""
        for (let offset = 0; offset <= scroll.scrollHeight; offset += 8) {
          scroll.scrollTo(offset)
          await view.renderOnce()
          allFrames += view.captureCharFrame()
        }
        for (let i = 0; i < 12; i++) expect(allFrames).toContain(`window${i}: осталось`)
        for (let i = 0; i < 3; i++) expect(allFrames).toContain(`user${i} pro`)
        scroll.scrollTo(scroll.scrollHeight)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("window11: осталось")
        scroll.scrollTo(0)
        await view.renderOnce()
        scroll.scrollChildIntoView(nodes.find(node => node instanceof ScrollBoxRenderable)!.getChildren()[1].id)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("provider2")
      } finally { await view.dispose() }
      const side = await testRender(() => sidebar({ name: "" }) as never, { width, height: 18 })
      try {
        await side.renderOnce()
        expect(side.captureCharFrame()).toContain("12 квот · мин. 0% + ?")
        expect(side.captureCharFrame()).toContain("user0")
        expect(side.captureCharFrame()).toContain("user1")
        expect(side.captureCharFrame()).not.toContain("example.test")
        expect(side.captureCharFrame().match(/provider0/g)?.length).toBe(1)
        const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
        for (const node of walk(side.renderer.root)) {
          expect(node.x).toBeGreaterThanOrEqual(0)
          expect(node.x + node.width).toBeLessThanOrEqual(width)
        }
      } finally { await side.dispose() }
    }
  } finally {
    await stop?.()
    server.stop(true)
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
    await file.delete()
  }
})

test("sidebar renders quota windows on one account line at narrow and wide widths", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  await Bun.write(`${import.meta.dir}/../dist/render-windows-test.js`, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-windows-test.js", import.meta.url).href)).default
  const providers = [
    { connectionId: "a", provider: "codex", quotas: { session: { windowSeconds: 604800, remainingPercentage: 80 } } },
    { connectionId: "longusername", provider: "codex", quotas: { session: { displayName: "session (5h)", remainingPercentage: 60 }, weekly: { displayName: "weekly (7d)", remainingPercentage: 80 } } },
    { connectionId: "c", provider: "codex", quotas: { session: { windowSeconds: 18000 }, weekly: { unlimited: true } } },
    { connectionId: "d", provider: "agy", quotas: { model: { remainingPercentage: 40 } } },
  ]
  const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/api/providers" ? Response.json({ connections: providers.map(p => ({ id: p.connectionId, email: `${p.connectionId}@example.test` })) }) : Response.json({ allowed: true, providers }) })
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  let sidebar: (input: { name: string }) => unknown = () => null
  const context = { options: { baseUrl: server.url.href }, theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777" } }, ui: { slot: (slot: { append: string, render: typeof sidebar }) => { if (slot.append === "sidebar.content") sidebar = slot.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Parameters<typeof plugin.setup>[0]
  const stop = await plugin.setup(context)
  try {
    await Bun.sleep(50)
    for (const width of [32, 70]) {
      const view = await testRender(() => sidebar({ name: "" }) as never, { width, height: 15 })
      try {
        await view.renderOnce()
        await view.renderOnce()
        const frame = view.captureCharFrame()
        const lines = frame.split("\n")
        console.log(`FRAME ${width}\n${frame}`)
        const header = lines.find(line => line.includes("Аккаунт") && line.includes("5ч"))!
        const weekly = lines.find(line => line.trimStart().startsWith("a "))!
        const both = lines.find(line => line.trimStart().startsWith("longuser"))!
        const unknown = lines.find(line => line.trimStart().startsWith("c "))!
        expect(weekly.indexOf("—")).toBe(header.indexOf("5ч"))
        expect(weekly.indexOf("█")).toBe(header.indexOf("7д"))
        expect(both.indexOf("█")).toBe(header.indexOf("5ч"))
        expect(both.indexOf("80%")).toBe(weekly.indexOf("80%"))
        expect(both).toContain(header.indexOf("5ч") > 15 ? "longusername" : "longuser…")
        expect(both).toContain(header.indexOf("5ч") > 15 ? "███░░ 60%" : "█ 60%")
        expect(unknown.indexOf("?")).toBe(header.indexOf("5ч"))
        expect(unknown.indexOf("∞")).toBe(header.indexOf("7д"))
        expect(lines.find(line => line.includes("d "))).toContain("1 квот · мин. 40%")
        expect(frame).not.toContain("example.test")
        expect(frame.match(/codex/g)?.length).toBe(1)
        expect(frame).toContain("agy")
        const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
        for (const node of walk(view.renderer.root)) {
          expect(node.x + node.width).toBeLessThanOrEqual(width)
        }
      } finally { await view.dispose() }
    }
  } finally {
    if (typeof stop === "function") stop()
    server.stop()
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
  }
})
