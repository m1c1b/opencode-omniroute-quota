import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  external: ["@opencode/plugin/tui", "@opentui/solid", "solid-js"],
  plugins: [createSolidTransformPlugin()],
})
if (!result.success) throw new AggregateError(result.logs, "Build failed")
