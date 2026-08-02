import { describe, test, expect, beforeEach, afterEach } from "bun:test"

import {
  parseModelMappings,
  applyModelMapping,
  getModelMappings,
  clearModelMappingsCache,
  resolveModel,
  detectClaudeAvailability,
  resolveClaudeFallback,
  GPT_FALLBACK_FOR_CLAUDE,
} from "../src/lib/model-mapping"

describe("parseModelMappings", () => {
  test("should return empty map for undefined input", () => {
    const result = parseModelMappings(undefined)
    expect(result.size).toBe(0)
  })

  test("should return empty map for empty string", () => {
    const result = parseModelMappings("")
    expect(result.size).toBe(0)
  })

  test("should return empty map for whitespace-only string", () => {
    const result = parseModelMappings("   ")
    expect(result.size).toBe(0)
  })

  test("should parse single mapping", () => {
    const result = parseModelMappings("claude-sonnet-4:claude-opus-4")
    expect(result.size).toBe(1)
    expect(result.get("claude-sonnet-4")).toBe("claude-opus-4")
  })

  test("should parse multiple mappings", () => {
    const result = parseModelMappings(
      "claude-sonnet-4:claude-opus-4,gpt-4:gpt-4-turbo",
    )
    expect(result.size).toBe(2)
    expect(result.get("claude-sonnet-4")).toBe("claude-opus-4")
    expect(result.get("gpt-4")).toBe("gpt-4-turbo")
  })

  test("should handle whitespace around mappings", () => {
    const result = parseModelMappings(
      " claude-sonnet-4 : claude-opus-4 , gpt-4 : gpt-4-turbo ",
    )
    expect(result.size).toBe(2)
    expect(result.get("claude-sonnet-4")).toBe("claude-opus-4")
    expect(result.get("gpt-4")).toBe("gpt-4-turbo")
  })

  test("should skip invalid mappings without colon", () => {
    const result = parseModelMappings(
      "valid-source:valid-target,invalid-mapping",
    )
    expect(result.size).toBe(1)
    expect(result.get("valid-source")).toBe("valid-target")
  })

  test("should skip mappings with empty source", () => {
    const result = parseModelMappings(":target,valid-source:valid-target")
    expect(result.size).toBe(1)
    expect(result.get("valid-source")).toBe("valid-target")
  })

  test("should skip mappings with empty target", () => {
    const result = parseModelMappings("source:,valid-source:valid-target")
    expect(result.size).toBe(1)
    expect(result.get("valid-source")).toBe("valid-target")
  })

  test("should handle model names with multiple colons (target contains colon)", () => {
    // Edge case: if target somehow contains colons
    const result = parseModelMappings("source:target:with:colons")
    expect(result.size).toBe(1)
    expect(result.get("source")).toBe("target:with:colons")
  })

  test("should skip empty pairs from trailing comma", () => {
    const result = parseModelMappings("source:target,")
    expect(result.size).toBe(1)
    expect(result.get("source")).toBe("target")
  })

  test("should handle model names with version numbers", () => {
    const result = parseModelMappings(
      "claude-sonnet-4-20250514:claude-opus-4-20250514",
    )
    expect(result.size).toBe(1)
    expect(result.get("claude-sonnet-4-20250514")).toBe(
      "claude-opus-4-20250514",
    )
  })
})

describe("applyModelMapping", () => {
  test("should return original model when no mappings", () => {
    const mappings = new Map<string, string>()
    const result = applyModelMapping("gpt-4", mappings)
    expect(result.model).toBe("gpt-4")
    expect(result.mapped).toBe(false)
  })

  test("should return original model when no match found", () => {
    const mappings = new Map<string, string>([
      ["claude-sonnet-4", "claude-opus-4"],
    ])
    const result = applyModelMapping("gpt-4", mappings)
    expect(result.model).toBe("gpt-4")
    expect(result.mapped).toBe(false)
  })

  test("should return mapped model when match found", () => {
    const mappings = new Map<string, string>([
      ["claude-sonnet-4", "claude-opus-4"],
    ])
    const result = applyModelMapping("claude-sonnet-4", mappings)
    expect(result.model).toBe("claude-opus-4")
    expect(result.mapped).toBe(true)
  })

  test("should handle multiple mappings and return correct match", () => {
    const mappings = new Map<string, string>([
      ["claude-sonnet-4", "claude-opus-4"],
      ["gpt-4", "gpt-4-turbo"],
    ])

    const result1 = applyModelMapping("claude-sonnet-4", mappings)
    expect(result1.model).toBe("claude-opus-4")
    expect(result1.mapped).toBe(true)

    const result2 = applyModelMapping("gpt-4", mappings)
    expect(result2.model).toBe("gpt-4-turbo")
    expect(result2.mapped).toBe(true)

    const result3 = applyModelMapping("gpt-3.5-turbo", mappings)
    expect(result3.model).toBe("gpt-3.5-turbo")
    expect(result3.mapped).toBe(false)
  })

  test("should work with verbose=false (default)", () => {
    const mappings = new Map<string, string>([["source", "target"]])
    const result = applyModelMapping("source", mappings, false)
    expect(result.model).toBe("target")
    expect(result.mapped).toBe(true)
  })

  test("should work with verbose=true", () => {
    const mappings = new Map<string, string>([["source", "target"]])
    // Just ensure it doesn't throw - verbose only affects logging
    const result = applyModelMapping("source", mappings, true)
    expect(result.model).toBe("target")
    expect(result.mapped).toBe(true)
  })
})

describe("getModelMappings", () => {
  const originalEnv = process.env.MODEL_MAPPINGS

  beforeEach(() => {
    clearModelMappingsCache()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MODEL_MAPPINGS
    } else {
      process.env.MODEL_MAPPINGS = originalEnv
    }
    clearModelMappingsCache()
  })

  test("should return empty map when env variable is not set", () => {
    delete process.env.MODEL_MAPPINGS
    const result = getModelMappings()
    expect(result.size).toBe(0)
  })

  test("should parse env variable correctly", () => {
    process.env.MODEL_MAPPINGS = "claude-sonnet-4:claude-opus-4"
    const result = getModelMappings()
    expect(result.size).toBe(1)
    expect(result.get("claude-sonnet-4")).toBe("claude-opus-4")
  })

  test("should cache results for same env value", () => {
    process.env.MODEL_MAPPINGS = "source:target"
    const result1 = getModelMappings()
    const result2 = getModelMappings()
    // Both should return the same cached map instance
    expect(result1).toBe(result2)
  })

  test("should refresh cache when env value changes", () => {
    process.env.MODEL_MAPPINGS = "source1:target1"
    const result1 = getModelMappings()
    expect(result1.get("source1")).toBe("target1")

    process.env.MODEL_MAPPINGS = "source2:target2"
    const result2 = getModelMappings()
    expect(result2.get("source2")).toBe("target2")
    expect(result2.get("source1")).toBeUndefined()
  })
})

describe("clearModelMappingsCache", () => {
  afterEach(() => {
    delete process.env.MODEL_MAPPINGS
    clearModelMappingsCache()
  })

  test("should clear the cache", () => {
    process.env.MODEL_MAPPINGS = "source:target"
    const result1 = getModelMappings()
    expect(result1.size).toBe(1)

    clearModelMappingsCache()

    // After clearing, it should re-parse from env
    process.env.MODEL_MAPPINGS = "different:mapping"
    const result2 = getModelMappings()
    expect(result2.get("different")).toBe("mapping")
    expect(result2.get("source")).toBeUndefined()
  })
})

describe("resolveModel", () => {
  // Mirrors the kind of ids the Copilot backend returns.
  const available = [
    "claude-opus-4.8",
    "claude-opus-4.7",
    "claude-opus-4.7-high",
    "claude-opus-4.7-1m-internal",
    "claude-opus-4.6",
    "claude-opus-4.6-1m",
    "claude-opus-4.5",
    "claude-sonnet-4.6",
    "claude-sonnet-4.5",
    "claude-haiku-4.5",
    "gpt-5.4",
    "gpt-4o",
  ]

  test("returns exact matches unchanged", () => {
    const result = resolveModel("claude-sonnet-4.5", available)
    expect(result).toEqual({ model: "claude-sonnet-4.5", mapped: false })
  })

  test("normalizes dashed version to dotted Copilot id", () => {
    const result = resolveModel("claude-opus-4-6", available)
    expect(result).toEqual({ model: "claude-opus-4.6", mapped: true })
  })

  test("strips trailing date suffix", () => {
    const result = resolveModel("claude-sonnet-4-5-20250929", available)
    expect(result).toEqual({ model: "claude-sonnet-4.5", mapped: true })
  })

  test("handles legacy family-after-version ordering", () => {
    const result = resolveModel("claude-3-5-haiku-20241022", available)
    // No 3.5 haiku available -> highest haiku in family
    expect(result).toEqual({ model: "claude-haiku-4.5", mapped: true })
  })

  test("falls back to highest available version in the same family", () => {
    const result = resolveModel("claude-opus-4-20250514", available)
    expect(result).toEqual({ model: "claude-opus-4.8", mapped: true })
  })

  test("prefers clean ids over suffixed variants for the same version", () => {
    // Remove the clean 4.6 so only suffixed variants remain at 4.6,
    // ensuring exact-version selection still avoids suffixed ids when possible.
    const ids = available.filter((id) => id !== "claude-opus-4.6")
    const result = resolveModel("claude-opus-4-6", ids)
    // 4.6 only exists as "-1m" now, so it should climb to highest clean opus
    expect(result.model).toBe("claude-opus-4.8")
  })

  test("returns unchanged when no family match exists", () => {
    const result = resolveModel("gpt-4o", available)
    expect(result).toEqual({ model: "gpt-4o", mapped: false })
  })

  test("returns unchanged for unknown non-claude models", () => {
    const result = resolveModel("some-random-model", available)
    expect(result).toEqual({ model: "some-random-model", mapped: false })
  })

  test("returns unchanged when no models are available", () => {
    const result = resolveModel("claude-opus-4-6", [])
    expect(result).toEqual({ model: "claude-opus-4-6", mapped: false })
  })
})

describe("detectClaudeAvailability", () => {
  const claudeAndGptIds = [
    "claude-opus-4.8",
    "claude-sonnet-4.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-4o",
  ]

  const gptOnlyIds = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-4o",
    "gpt-5.4",
  ]

  test("reports Claude available when Claude models exist", () => {
    const { claudeAvailable, fallback } =
      detectClaudeAvailability(claudeAndGptIds)
    expect(claudeAvailable).toBe(true)
    expect(fallback.size).toBe(0)
  })

  test("reports Claude unavailable and builds fallback when only GPT models available", () => {
    const { claudeAvailable, fallback } = detectClaudeAvailability(gptOnlyIds)
    expect(claudeAvailable).toBe(false)
    expect(fallback.size).toBe(3)
    expect(fallback.get("opus")).toBe("gpt-5.6-sol")
    expect(fallback.get("sonnet")).toBe("gpt-5.6-terra")
    expect(fallback.get("haiku")).toBe("gpt-5.6-luna")
  })

  test("only includes fallback entries for GPT tiers that are actually available", () => {
    const partial = ["gpt-5.6-sol", "gpt-4o"] // no terra/luna
    const { claudeAvailable, fallback } = detectClaudeAvailability(partial)
    expect(claudeAvailable).toBe(false)
    expect(fallback.size).toBe(1)
    expect(fallback.get("opus")).toBe("gpt-5.6-sol")
    expect(fallback.has("sonnet")).toBe(false)
    expect(fallback.has("haiku")).toBe(false)
  })

  test("returns empty fallback when no models at all", () => {
    const { claudeAvailable, fallback } = detectClaudeAvailability([])
    expect(claudeAvailable).toBe(false)
    expect(fallback.size).toBe(0)
  })

  test("GPT_FALLBACK_FOR_CLAUDE defines the three expected tiers", () => {
    expect(GPT_FALLBACK_FOR_CLAUDE.opus).toBe("gpt-5.6-sol")
    expect(GPT_FALLBACK_FOR_CLAUDE.sonnet).toBe("gpt-5.6-terra")
    expect(GPT_FALLBACK_FOR_CLAUDE.haiku).toBe("gpt-5.6-luna")
  })
})

describe("resolveClaudeFallback", () => {
  const fullFallback = new Map([
    ["opus", "gpt-5.6-sol"],
    ["sonnet", "gpt-5.6-terra"],
    ["haiku", "gpt-5.6-luna"],
  ])

  test("maps claude-opus variants to gpt-5.6-sol", () => {
    expect(resolveClaudeFallback("claude-opus-4-6", fullFallback)).toEqual({
      model: "gpt-5.6-sol",
      mapped: true,
    })
    expect(resolveClaudeFallback("claude-opus-4.8", fullFallback)).toEqual({
      model: "gpt-5.6-sol",
      mapped: true,
    })
    expect(
      resolveClaudeFallback("claude-3-opus-20240229", fullFallback),
    ).toEqual({ model: "gpt-5.6-sol", mapped: true })
  })

  test("maps claude-sonnet variants to gpt-5.6-terra", () => {
    expect(resolveClaudeFallback("claude-sonnet-4-5", fullFallback)).toEqual({
      model: "gpt-5.6-terra",
      mapped: true,
    })
    expect(
      resolveClaudeFallback("claude-sonnet-4-5-20250929", fullFallback),
    ).toEqual({ model: "gpt-5.6-terra", mapped: true })
  })

  test("maps claude-haiku variants to gpt-5.6-luna", () => {
    expect(resolveClaudeFallback("claude-haiku-4-5", fullFallback)).toEqual({
      model: "gpt-5.6-luna",
      mapped: true,
    })
    expect(
      resolveClaudeFallback("claude-3-5-haiku-20241022", fullFallback),
    ).toEqual({ model: "gpt-5.6-luna", mapped: true })
  })

  test("returns unchanged for non-Claude models", () => {
    expect(resolveClaudeFallback("gpt-4o", fullFallback)).toEqual({
      model: "gpt-4o",
      mapped: false,
    })
    expect(resolveClaudeFallback("gpt-5.6-sol", fullFallback)).toEqual({
      model: "gpt-5.6-sol",
      mapped: false,
    })
  })

  test("returns unchanged when fallback map is empty", () => {
    const empty = new Map<string, string>()
    expect(resolveClaudeFallback("claude-opus-4-6", empty)).toEqual({
      model: "claude-opus-4-6",
      mapped: false,
    })
  })

  test("returns unchanged when family has no entry in partial fallback", () => {
    const opusOnly = new Map([["opus", "gpt-5.6-sol"]])
    expect(resolveClaudeFallback("claude-sonnet-4-5", opusOnly)).toEqual({
      model: "claude-sonnet-4-5",
      mapped: false,
    })
  })
})
