import { expect, test } from "bun:test"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { insert, testRender, useRenderer } from "@opentui/solid"
import { BoxRenderable, RGBA, ScrollBoxRenderable, type Renderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { createRoot } from "solid-js"
import { maskAccountName } from "../src/tui"

test("account masks contain ten code points without overlapping short names", () => {
  for (const [name, masked] of [["11company08", "11co****08"], ["pupa67", "pupa****67"], ["abcde", "abcd*****e"], ["a", "a*********"], ["", "**********"], ["😀😁😂🤣😃😄", "😀😁😂🤣****😃😄"]]) {
    expect(maskAccountName(name)).toBe(masked)
    expect(Array.from(maskAccountName(name))).toHaveLength(10)
  }
})

test("Escape closes only the quota panel and slots are removed", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  const file = Bun.file(`${import.meta.dir}/../dist/render-key-test.js`)
  await Bun.write(file, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-key-test.js", import.meta.url).href)).default
  type Layer = { enabled?: boolean; commands: { id?: string; bind?: string; run: () => void }[] }
  const layers: (() => Layer)[] = []
  let current: string | undefined
  let closes = 0
  let removed = 0
  const context = { options: {}, ui: { panel: { open: (name: string) => { current = name; return true }, current: () => current && { name: current }, close: () => { closes++; current = undefined } }, slot: () => () => { removed++ } }, keymap: { layer: (factory: () => Layer) => layers.push(factory) } } as unknown as Plugin.Context
  let dispose = () => {}
  const stop = await createRoot(end => { dispose = end; return plugin.setup(context) })
  try {
    const back = layers.find(layer => layer().commands.some(command => command.bind === "escape"))!
    const open = layers.flatMap(layer => layer().commands).find(command => command.id === "omni-quota.open")!
    expect(back().enabled).toBe(false)
    open.run()
    expect(back().enabled).toBe(true)
    back().commands[0].run()
    expect(closes).toBe(1)
    expect(back().enabled).toBe(false)
    current = "another-panel"
    expect(back().enabled).toBe(false)
  } finally {
    if (typeof stop === "function") stop()
    dispose()
    await file.delete()
  }
  expect(removed).toBe(2)
})

test("refresh command reports authorization failures without server details", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  const file = Bun.file(`${import.meta.dir}/../dist/render-refresh-test.js`)
  await Bun.write(file, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-refresh-test.js", import.meta.url).href)).default
  const server = Bun.serve({ port: 0, fetch: request => request.method === "POST" ? new Response("sensitive server detail", { status: 403 }) : Response.json({ allowed: true, providers: [] }) })
  type Layer = { commands: { id?: string; run: () => void }[] }
  const layers: (() => Layer)[] = []
  const messages: string[] = []
  const context = { options: { baseUrl: server.url.href, apiKey: "test" }, ui: { panel: { current: () => undefined }, slot: () => () => {}, toast: { show: ({ message }: { message: string }) => messages.push(message) } }, keymap: { layer: (factory: () => Layer) => layers.push(factory) } } as unknown as Plugin.Context
  let dispose = () => {}
  const stop = await createRoot(end => { dispose = end; return plugin.setup(context) })
  try {
    layers.flatMap(layer => layer().commands).find(command => command.id === "omni-quota.refresh")!.run()
    for (let i = 0; i < 100 && !messages.length; i++) await Bun.sleep(5)
    expect(messages).toEqual(["Refresh requires a management token with manage or admin scope"])
  } finally {
    if (typeof stop === "function") stop()
    dispose()
    server.stop(true)
    await file.delete()
  }
})

test("Shaded matches ascii-bar partial fill levels", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  const file = Bun.file(`${import.meta.dir}/../dist/render-shaded-test.js`)
  await Bun.write(file, result.outputs[0])
  try {
    const { shaded } = await import(new URL("../dist/render-shaded-test.js", import.meta.url).href)
    expect(shaded(0, 10)).toBe("░░░░░░░░░░")
    expect(shaded(5, 10)).toBe("▒░░░░░░░░░")
    expect(shaded(8, 10)).toBe("▓░░░░░░░░░")
    expect(shaded(50, 10)).toBe("█████▒░░░░")
    expect(shaded(96, 10)).toBe("█████████▒")
    expect(shaded(98, 10)).toBe("█████████▓")
    expect(shaded(100, 10)).toBe("██████████")
  } finally { await file.delete() }
})

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
  const context = { options: { baseUrl: server.url.href }, theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777", action: { primary: { base: "#ff8800" } } } }, ui: { slot: (claim: { append: string; render: typeof panel }) => { if (claim.append === "session.panel") panel = claim.render; if (claim.append === "sidebar.content") sidebar = claim.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Plugin.Context
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
        const headers = nodes.slice(2, 6)
        expect(frame).toContain("OmniRoute: ready")
        expect(frame).toContain("Esc Back")
        expect(frame).toContain("Cache · no routing guarantee")
        expect(frame).toContain("Received by plugin:")
        expect(frame).toContain("provider0")
        expect(frame).toContain("user0 pro")
        expect(frame).not.toContain("example.test")
        expect(frame).toContain("window0: remaining")
        expect(frame).toContain("░░░░░░░░░░ 0%")
        expect(frame).toContain("Used 10 / 10")
        expect(headers[1].y).toBe(headers[0].y + headers[0].height)
        expect(headers[2].y).toBe(headers[1].y + headers[1].height)
        expect(headers[3].y).toBe(headers[2].y + headers[2].height)
        expect(scroll.y).toBe(headers[3].y + headers[3].height)
        expect(scroll.y + scroll.height).toBe(18)
        expect(scroll.scrollHeight).toBeGreaterThan(scroll.height)
        expect((nodes[1] as BoxRenderable).backgroundColor).toEqual(RGBA.fromHex("#101010"))
        for (const node of nodes) {
          expect(node.x).toBeGreaterThanOrEqual(0)
          expect(node.x + node.width).toBeLessThanOrEqual(width)
        }
        scroll.scrollTo(4)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("█████▒░░░░ 50%")
        expect(view.captureCharFrame()).toContain("██████████ 100%")
        scroll.scrollTo(12)
        await view.renderOnce()
        const middle = view.captureCharFrame()
        expect(middle).toMatch(/window3: remaining\s+\?(?!\s*\d+%)/)
        expect(middle).toMatch(/window4: remaining\s+∞(?!\s*\d+%)/)
        let allFrames = ""
        for (let offset = 0; offset <= scroll.scrollHeight; offset += 8) {
          scroll.scrollTo(offset)
          await view.renderOnce()
          allFrames += view.captureCharFrame()
        }
        for (let i = 0; i < 12; i++) expect(allFrames).toContain(`window${i}: remaining`)
        for (let i = 0; i < 3; i++) expect(allFrames).toContain(`user${i} pro`)
        scroll.scrollTo(scroll.scrollHeight)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("window11: remaining")
        scroll.scrollTo(0)
        await view.renderOnce()
        scroll.scrollChildIntoView(nodes.find(node => node instanceof ScrollBoxRenderable)!.getChildren()[1].id)
        await view.renderOnce()
        expect(view.captureCharFrame()).toContain("provider2")
      } finally { await view.dispose() }
      const side = await testRender(() => sidebar({ name: "" }) as never, { width, height: 18 })
      try {
        await side.renderOnce()
        await side.renderOnce()
        expect(side.captureCharFrame()).toContain("12 quotas · min. 0% + ?")
        expect(side.captureCharFrame()).toContain("user*****0")
        expect(side.captureCharFrame()).toContain("user*****1")
        expect(side.captureCharFrame()).not.toContain("example.test")
        expect(side.captureCharFrame().match(/PROVIDER0/g)?.length).toBe(1)
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

test("sidebar left-aligns numbered accounts under full-width provider rules", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  await Bun.write(`${import.meta.dir}/../dist/render-windows-test.js`, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-windows-test.js", import.meta.url).href)).default
  const providers = [
    { connectionId: "a", provider: "codex", quotas: { session: { windowSeconds: 604800, used: 20, total: 100, remainingPercentage: 80 } } },
    { connectionId: "longusername", provider: "codex", quotas: { session: { displayName: "session (5h)", remainingPercentage: 60 }, weekly: { displayName: "weekly (7d)", remainingPercentage: 80 } } },
    { connectionId: "c", provider: "codex", quotas: { session: { windowSeconds: 18000 }, weekly: { unlimited: true } } },
    { connectionId: "zero", provider: "codex", quotas: { session: { windowSeconds: 18000, used: 100, total: 100, remainingPercentage: 0 } } },
    { connectionId: "d", provider: "agy", quotas: { model: { remainingPercentage: 40 }, gemini_weekly: { quotaGroupId: "gemini", quotaAggregate: true, window: "weekly", remainingPercentage: 25 }, gemini_session: { quotaGroupId: "gemini", quotaAggregate: true, window: "session", unlimited: true }, claude_gpt_weekly: { quotaGroupId: "claude_gpt", quotaAggregate: true, window: "weekly" } } },
  ]
  const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/api/providers" ? Response.json({ connections: providers.map(p => ({ id: p.connectionId, email: `${p.connectionId}@example.test` })) }) : Response.json({ allowed: true, providers }) })
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  let sidebar: (input: { name: string }) => unknown = () => null
  const context = { options: { baseUrl: server.url.href }, theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777", action: { primary: { base: "#ff8800" } } } }, ui: { slot: (slot: { append: string, render: typeof sidebar }) => { if (slot.append === "sidebar.content") sidebar = slot.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Parameters<typeof plugin.setup>[0]
  const stop = await plugin.setup(context)
  try {
    await Bun.sleep(50)
    for (const width of [32, 70]) {
      let container!: BoxRenderable
      let scroll!: ScrollBoxRenderable
      const view = await testRender(() => {
        const renderer = useRenderer()
        container = new BoxRenderable(renderer, { width: "100%", height: "100%" })
        scroll = new ScrollBoxRenderable(renderer, { width: "100%", height: "100%", scrollX: false })
        container.add(scroll)
        insert(scroll, () => sidebar({ name: "" }) as never)
        return container as never
      }, { width, height: 18 })
      try {
        await view.renderOnce()
        await Bun.sleep(20)
        await view.renderOnce()
        const frame = view.captureCharFrame()
        const lines = frame.split("\n")
        expect(frame).not.toMatch(/[╭╮╰╯]/)
        expect(frame).not.toMatch(/[┌┐└┘│]/)
        expect(lines.find(line => line.startsWith("─"))).toContain("─".repeat(width - 1))
        expect(frame).toContain("long****me")
        expect(frame).not.toContain("longusername")
        expect(frame).toMatch(/5h [█░▒▓]+\s+60%/)
        expect(frame).toMatch(/7d [█░▒▓]+\s+80%/)
        expect(frame).toMatch(/5h [░]+\s+\?/)
        expect(frame).toMatch(/7d [░]+\s+∞/)
        expect(frame).toMatch(/1  a[^\n]*\n\s*7d [█░▒▓]+\s+80%[^\n]*\n─+/)
        expect(lines.find(line => line.includes("CODEX"))!.startsWith("CODEX")).toBe(true)
        const bars = lines.filter(line => /[57][hd] [█░▒▓]+/.test(line))
        expect(new Set(bars.map(line => line.match(/[█░▒▓]+/)![0].length)).size).toBe(1)
        expect(bars[0].match(/[█░▒▓]+/)![0].length).toBeGreaterThan(10)
        expect(frame).not.toContain("example.test")
        expect(container.width).toBe(width)
        let allFrames = frame
        for (let offset = 0; offset <= scroll.scrollHeight; offset += 5) {
          scroll.scrollTo(offset)
          await view.renderOnce()
          allFrames += view.captureCharFrame()
        }
        for (const name of ["1  a*********", "2  c*********", "3  long****me", "1  d*********"]) expect(allFrames).toContain(name)
        expect(allFrames).toContain("Gemini weekly")
        expect(allFrames).toContain("Gemini session")
        expect(allFrames).toContain(width === 32 ? "Claude/GPT weekly" : "Claude/GPT weekly")
        expect(allFrames).toContain("25%")
        expect(allFrames).not.toContain("4 quotas · min.")
        expect(allFrames).not.toContain("example.test")
        expect(frame.match(/CODEX/g)?.length).toBe(1)
        expect(allFrames).toContain("AGY")
        expect(allFrames).toMatch(/3  long\*{4}me[^\n]*\n[^\n]*5h [^\n]*60%[^\n]*\n[^\n]*7d [^\n]*80%/)
        expect(allFrames).toMatch(/5h [░]+\s+0%/)
        expect(allFrames).toMatch(/7d [░]+\s+—/)
        const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
        for (const node of walk(view.renderer.root)) {
          expect(node.x + node.width).toBeLessThanOrEqual(width)
        }
        if (width === 32) {
          view.resize(70, 18)
          scroll.scrollTo(0)
          await view.renderOnce()
          await view.renderOnce()
          expect(container.width).toBe(70)
          expect(view.captureCharFrame().split("\n").find(line => line.includes("1  a"))).not.toContain("2  c")
          view.resize(32, 18)
          await view.renderOnce()
          await view.renderOnce()
          expect(view.captureCharFrame().split("\n").find(line => line.includes("1  a"))).not.toContain("2  c")
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

test("style options render real sidebar and details at both widths", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  const file = Bun.file(`${import.meta.dir}/../dist/render-styles-test.js`)
  await Bun.write(file, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-styles-test.js", import.meta.url).href)).default
  const providers = [
    { connectionId: "longaccountnameexample", provider: "codex", quotas: { weekly: { windowSeconds: 604800, used: 20, total: 100, remainingPercentage: 80 } } },
    { connectionId: "b", provider: "codex", quotas: { session: { windowSeconds: 18000 }, weekly: { windowSeconds: 604800, unlimited: true } } },
    { connectionId: "c", provider: "agy", quotas: { gemini_weekly: { quotaGroupId: "gemini", quotaAggregate: true, window: "weekly", remainingPercentage: 25 }, gemini_session: { quotaGroupId: "gemini", quotaAggregate: true, window: "session", unlimited: true }, claude_gpt_session: { quotaGroupId: "claude_gpt", quotaAggregate: true, window: "session", remainingPercentage: 42 } } },
    { connectionId: "d", provider: "other", quotas: { model: { remainingPercentage: 50 } } },
    { connectionId: "e", provider: "weeklyonly", quotas: { weekly: { windowSeconds: 604800, remainingPercentage: 42 } } },
    { connectionId: "f", provider: "codex", quotas: { session: { windowSeconds: 18000, used: 100, total: 100, remainingPercentage: 0 } } },
    ...Array.from({ length: 10 }, (_, i) => ({ connectionId: `number${i}`, provider: "numbers", quotas: { weekly: { windowSeconds: 604800, remainingPercentage: 50 } } })),
  ]
  const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/api/providers" ? Response.json({ connections: providers.map(p => ({ id: p.connectionId, email: `${p.connectionId}@example.test` })) }) : Response.json({ allowed: true, providers }) })
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  try {
    for (const style of [undefined, "bar-style", "percents-only-style", "invalid"]) {
      let sidebar: (input: { name: string }) => unknown = () => null
      let panel: (input: { name: string }) => unknown = () => null
      const context = { options: { baseUrl: server.url.href, style }, theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777", action: { primary: { base: "#ff8800" } } } }, ui: { slot: (slot: { append?: string, replace?: string, render: typeof sidebar }) => { if (slot.append === "sidebar.content") sidebar = slot.render; if (slot.append === "session.panel") panel = slot.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Parameters<typeof plugin.setup>[0]
      const stop = await plugin.setup(context)
      try {
        await Bun.sleep(50)
        for (const width of [32, 70]) {
          const view = await testRender(() => sidebar({ name: "" }) as never, { width, height: 70 })
          try {
            await view.renderOnce()
            await view.renderOnce()
            const frame = view.captureCharFrame()
            expect(frame).toMatch(/▼ ⚙️ Quota · Updated \d\d:\d\d:\d\d/)
            expect(frame).toContain("long****le")
            expect(frame).not.toContain("longaccountnameexample")
            expect(frame).not.toContain("example.test")
            const spans = view.captureSpans().lines.flatMap(line => line.spans)
            const color = (text: string) => spans.find(span => span.text.includes(text))!.fg.toString()
            expect(color("CODEX")).toBe(RGBA.fromHex("#ff8800").toString())
            const providerSpan = spans.find(span => span.text.includes("CODEX"))!
            expect(frame).toContain("#1")
            if (style === "percents-only-style") {
              expect(color("ACCOUNT")).toBe(RGBA.fromHex("#777777").toString())
              expect(frame).not.toMatch(/[█░]/)
              expect(frame).toContain("ACCOUNT")
              expect(frame).toContain("Gemini · session: ∞")
              expect(frame).toContain("Claude/GPT · session: 42%")
              expect(frame).toContain("min. 50%")
              expect(frame).toMatch(/\?\s+∞/)
              const lines = frame.split("\n")
              const mixedHeader = lines.findIndex(line => line.includes("ACCOUNT") && line.includes("5h"))
              const weeklyLine = lines.find(line => line.includes("long") && line.includes("80%"))!
              expect(weeklyLine.slice(lines[mixedHeader].indexOf("5h") - 4, lines[mixedHeader].indexOf("7d") - 4).trim()).toBe("")
              expect(weeklyLine.indexOf("80%") + 3).toBe(lines[mixedHeader].indexOf("7d") + 2)
              expect(frame).toMatch(/0%\s+—/)
              const weeklyGroup = lines.findIndex(line => line.includes("WEEKLYONLY"))
              expect(lines[weeklyGroup + 1]).toContain("7d")
              expect(lines[weeklyGroup + 1]).not.toContain("5h")
              const numbers = lines.findIndex(line => line.includes("NUMBERS"))
              const numberHeader = lines[numbers + 1]
              const tenth = lines.find(line => line.includes("#10"))!
              expect(tenth).toContain("#10 ")
              expect(tenth.indexOf("50%") + 3).toBe(numberHeader.indexOf("7d") + 2)
              expect(frame).toMatch(/b[^\n]*\n─+\n.*f/)
              expect(frame).not.toMatch(/long[^\n]*\n─+/)
              const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
              for (const node of walk(view.renderer.root)) expect(node.x + node.width).toBeLessThanOrEqual(width)
            } else {
              expect(frame).toMatch(/[█░]/)
              expect(color("7d")).toBe(RGBA.fromHex("#777777").toString())
              expect(color("80%")).toBe(RGBA.fromHex("#ffffff").toString())
              expect(color("█")).toBe(RGBA.fromHex("#ffffff").toString())
            }
            await view.mockMouse.click(2, 1)
            await view.renderOnce()
            const collapsed = view.captureCharFrame()
            expect(collapsed.split("\n").find(line => line.includes("⚙️"))!.trim()).toBe("▶ ⚙️ · CODEX · 0% · 80%")
            expect(collapsed).not.toMatch(/\d\d:\d\d:\d\d|Updated/)
            expect(collapsed).not.toContain("[")
            const headerLine = view.captureSpans().lines.find(line => line.spans.some(span => span.text.includes("CODEX")))!
            const dots = headerLine.spans.filter(span => span.text.includes("·"))
            expect(dots.map(span => span.text).join("").match(/·/g)).toHaveLength(3)
            dots.forEach(span => expect(span.fg.toString()).toBe(RGBA.fromHex("#777777").toString()))
            for (const span of headerLine.spans.filter(span => !span.text.includes("·")).filter(span => span.text.trim())) {
              expect(span.fg.toString()).toBe(providerSpan.fg.toString())
              expect(span.attributes).toBe(providerSpan.attributes)
            }
            const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
            for (const node of walk(view.renderer.root)) expect(node.x + node.width).toBeLessThanOrEqual(width)
            expect(collapsed).not.toContain("/omni-quota")
            await view.mockMouse.click(2, 1)
            await view.renderOnce()
            expect(view.captureCharFrame()).toMatch(/▼ ⚙️ Quota · Updated \d\d:\d\d:\d\d/)
          } finally { await view.dispose() }
        }
        const detail = await testRender(() => panel({ name: "omni-quota" }) as never, { width: 70, height: 35 })
        try {
          await detail.renderOnce()
          await detail.renderOnce()
          const frame = detail.captureCharFrame().split("\n").map(line => line.slice(0, -1)).join("\n")
          if (style === "percents-only-style") expect(frame).not.toMatch(/[█░]/)
          else expect(frame).toMatch(/[█░]/)
        } finally { await detail.dispose() }
      } finally { if (typeof stop === "function") stop() }
    }
  } finally {
    server.stop(true)
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
    await file.delete()
  }
})

test("collapsed summary uses only the first displayed provider", async () => {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  const file = Bun.file(`${import.meta.dir}/../dist/render-first-provider-test.js`)
  await Bun.write(file, result.outputs[0])
  const plugin: Plugin.Definition = (await import(new URL("../dist/render-first-provider-test.js", import.meta.url).href)).default
  const previousKey = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  try {
    for (const [firstQuotas, expected] of [[{ session: { windowSeconds: 18000, used: 75, total: 100, remainingPercentage: 90 } }, "▶ ⚙️ · FIRST · 25% · —"], [{ weekly: { windowSeconds: 604800, used: 5, total: 100 } }, "▶ ⚙️ · FIRST · — · 95%"], [{ other: { remainingPercentage: 25 }, weekly: { windowSeconds: 604800, unlimited: true }, session: { windowSeconds: 18000, remaining: 25, total: 100 } }, "▶ ⚙️ · FIRST · — · —"]] as const) {
      const providers = [
        { connectionId: "z", provider: "second", quotas: { session: { windowSeconds: 18000, used: 10, total: 100, remainingPercentage: 90 }, weekly: { windowSeconds: 604800, used: 20, total: 100, remainingPercentage: 80 } } },
        { connectionId: "a", provider: "first", quotas: firstQuotas },
        { connectionId: "zz", provider: "thirdproviderwithaverylongname", quotas: { weekly: { windowSeconds: 604800, used: 1, total: 10 } } },
        { connectionId: "zzz", provider: "fourth", quotas: {} },
      ]
      const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/api/providers" ? Response.json({ connections: [] }) : Response.json({ allowed: true, providers }) })
      for (const style of ["bar-style", "percents-only-style"]) {
      let sidebar: (input: { name: string }) => unknown = () => null
      const context = { options: { baseUrl: server.url.href, style }, theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777", action: { primary: { base: "#ff8800" } } } }, ui: { slot: (slot: { append?: string, render: typeof sidebar }) => { if (slot.append === "sidebar.content") sidebar = slot.render; return () => {} } }, keymap: { layer: () => {} } } as unknown as Parameters<typeof plugin.setup>[0]
      const stop = await plugin.setup(context)
      try {
        await Bun.sleep(50)
        for (const width of [32, 70]) {
        const view = await testRender(() => sidebar({ name: "" }) as never, { width, height: 20 })
        try {
          await view.renderOnce()
          await view.mockMouse.click(2, 1)
          await view.renderOnce()
          const frame = view.captureCharFrame()
          expect(frame.split("\n").find(line => line.includes("⚙️"))!.trim()).toBe(expected)
          expect(frame).not.toContain("SECOND")
          expect(frame).not.toContain("THIRD")
          expect(frame).not.toContain("FOURTH")
          const walk = (node: Renderable): Renderable[] => [node, ...node.getChildren().flatMap(walk)]
          for (const node of walk(view.renderer.root)) expect(node.x + node.width).toBeLessThanOrEqual(width)
          await view.mockMouse.click(2, 1)
          await view.renderOnce()
        } finally { await view.dispose() }
        }
      } finally { if (typeof stop === "function") stop() }
      }
      server.stop(true)
    }
  } finally {
    if (previousKey === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previousKey
    await file.delete()
  }
})
