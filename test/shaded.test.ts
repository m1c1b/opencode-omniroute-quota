import { describe, expect, test } from "bun:test"
import { shaded } from "../src/shaded"

describe("shaded", () => {
  test.each([
    [0, "░░░░░░░░░░"],
    [10, "█░░░░░░░░░"],
    [15, "█▒░░░░░░░░"],
    [50, "█████░░░░░"],
    [100, "██████████"],
  ])("renders %i percent at width 10", (value, expected) => {
    expect(shaded(value, 10)).toBe(expected)
  })

  test.each([1, 2, 10])("never exceeds width %i at high percentages", width => {
    for (const value of [95, 96, 99, 100, 110]) {
      expect(shaded(value, width)).toHaveLength(width)
    }
  })
})
