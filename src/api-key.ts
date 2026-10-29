export function resolveApiKey(option: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const value = typeof option === "string" ? option : env.OMNIROUTE_API_KEY ?? ""
  const reference = /^\{env:([^{}]+)\}$/.exec(value)
  const key = reference ? env[reference[1]] ?? "" : value
  return key.trim() && !key.includes("{env:") ? key : ""
}
