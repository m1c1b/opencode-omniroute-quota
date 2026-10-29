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
  const providers = Array.from({ length: 3 }, (_, i) => ({ connectionId: `account${i}`, provider: `provider${i}`, plan: "pro", quotas: Object.fromEntries(Array.from({ length: 12 }, (_, j) => [`window${j}`, { used: 2, total: 10 }])) }))
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ allowed: true, providers }) })
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  let panel: (input: { name: string }) => unknown = () => null
  const context = { options: { baseUrl: server.url.href }, theme: { background: { base: "#101010" } }, ui: { slot: (claim: { append: string; render: typeof panel }) => { if (claim.append === "session.panel") panel = claim.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Plugin.Context
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
        expect(frame).toContain("Кеш OmniRoute · сырые проценты,")
        expect(frame).toContain("Получено плагином:")
        expect(frame).toContain("provider0 pro [account0]")
        expect(frame).toContain("window0: осталось 80%;")
        expect(headers[1].y).toBe(headers[0].y + headers[0].height)
        expect(headers[2].y).toBe(headers[1].y + headers[1].height)
        expect(scroll.y).toBe(headers[2].y + headers[2].height)
        expect(scroll.y + scroll.height).toBe(18)
        expect(scroll.scrollHeight).toBeGreaterThan(scroll.height)
        expect((nodes[1] as BoxRenderable).backgroundColor).toEqual(RGBA.fromHex("#101010"))
        scroll.scrollTo(scroll.scrollHeight)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("window11: осталось 80%;")
        scroll.scrollTo(0)
        await view.renderOnce()
        scroll.scrollChildIntoView(nodes.find(node => node instanceof ScrollBoxRenderable)!.getChildren()[2].id)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("provider2 pro [account2]")
      } finally { await view.dispose() }
    }
  } finally {
    await stop?.()
    server.stop(true)
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
    await file.delete()
  }
})
