import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { Plugin } from "@opencode/plugin/tui"

type Slot = { append?: string; render: (input: { name: string }) => unknown }

export function renderContext(baseUrl: string, style?: string, pinnedProvider?: string, startClosed?: unknown) {
  const slots: Record<string, Slot["render"]> = {}
  const context = {
    options: { baseUrl, style, pinnedProvider, "start-closed": startClosed },
    theme: { background: { base: "#101010" }, text: { base: "#ffffff", muted: "#777777", action: { primary: { base: "#ff8800" } } } },
    ui: { slot: (slot: Slot) => { if (slot.append) slots[slot.append] = slot.render; return () => {} } },
    keymap: { layer: () => {} },
  } as unknown as Plugin.Context
  return { context, slots }
}

export async function buildRenderPlugin(name: string) {
  const result = await Bun.build({ entrypoints: ["src/tui.tsx"], target: "bun", external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"], plugins: [createSolidTransformPlugin()] })
  if (!result.success) throw new AggregateError(result.logs, "Failed to build render test plugin")
  const file = Bun.file(`${import.meta.dir}/../../dist/${name}.js`)
  await Bun.write(file, result.outputs[0])
  return { file, url: new URL(`../../dist/${name}.js`, import.meta.url).href }
}

export function setTestApiKey() {
  const previous = process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY = "test"
  return () => {
    if (previous === undefined) delete process.env.OMNIROUTE_API_KEY
    else process.env.OMNIROUTE_API_KEY = previous
  }
}
