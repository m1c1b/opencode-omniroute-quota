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
  const providers = Array.from({ length: 3 }, (_, i) => ({ connectionId: `account${i}`, provider: `provider${i}`, plan: "pro", quotas: Object.fromEntries(Array.from({ length: 12 }, (_, j) => [`window${j}`, j === 0 ? { used: 10, total: 10 } : j === 1 ? { used: 5, total: 10 } : j === 2 ? { used: 0, total: 10 } : j === 3 ? {} : j === 4 ? { unlimited: true } : { used: 2, total: 10 }])) }))
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ allowed: true, providers }) })
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
        const frame = view.captureCharFrame()
        const headers = nodes.slice(2, 5)
        expect(frame).toContain("OmniRoute: ready")
        expect(frame).toContain("Кеш OmniRoute · не гарантия")
        expect(frame).toContain("Получено плагином:")
        expect(frame).toContain("provider0 pro [account0]")
        expect(frame).toContain("window0: осталось")
        expect(frame).toContain("░░░░░░░░░░")
        expect(frame).toContain("Использовано 10 / 10")
        expect(frame).not.toContain("%")
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
        expect(view.captureCharFrame()).toContain("█████░░░░░")
        expect(view.captureCharFrame()).toContain("██████████")
        scroll.scrollTo(12)
        await view.renderOnce()
        const middle = view.captureCharFrame()
        expect(middle).toMatch(/window3: осталось\s+\?/)
        expect(middle).toMatch(/window4: осталось\s+∞/)
        let allFrames = ""
        for (let offset = 0; offset <= scroll.scrollHeight; offset += 8) {
          scroll.scrollTo(offset)
          await view.renderOnce()
          allFrames += view.captureCharFrame()
        }
        for (let i = 0; i < 12; i++) expect(allFrames).toContain(`window${i}: осталось`)
        for (let i = 0; i < 3; i++) expect(allFrames).toContain(`provider${i} pro [account${i}]`)
        scroll.scrollTo(scroll.scrollHeight)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("window11: осталось")
        scroll.scrollTo(0)
        await view.renderOnce()
        scroll.scrollChildIntoView(nodes.find(node => node instanceof ScrollBoxRenderable)!.getChildren()[2].id)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("provider2 pro [account2]")
      } finally { await view.dispose() }
      const side = await testRender(() => sidebar({ name: "" }) as never, { width, height: 18 })
      try {
        await side.renderOnce()
        expect(side.captureCharFrame()).toContain("░░░░░░░░░░")
        expect(side.captureCharFrame()).not.toContain("%")
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
