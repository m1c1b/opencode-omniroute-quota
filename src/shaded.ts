export const shaded = (value: number, width: number) => {
  const amount = Math.max(0, Math.min(100, value)) * width / 100
  const full = Math.floor(amount)
  if (full === width) return "█".repeat(width)
  const partial = amount === full ? "░" : "░▒▓█"[Math.max(1, Math.floor((amount - full) * 3))]
  return "█".repeat(full) + partial + "░".repeat(width - full - 1)
}
