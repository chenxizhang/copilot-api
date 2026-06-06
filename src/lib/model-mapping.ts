import consola from "consola"

/**
 * Parse model mappings from environment variable.
 * Format: "source1:target1,source2:target2"
 * Example: "claude-sonnet-4-20250514:claude-opus-4-20250514,gpt-4:gpt-4-turbo"
 */
export function parseModelMappings(envValue?: string): Map<string, string> {
  const mappings = new Map<string, string>()

  if (!envValue || envValue.trim() === "") {
    return mappings
  }

  const pairs = envValue.split(",")
  for (const pair of pairs) {
    const trimmedPair = pair.trim()
    if (!trimmedPair) continue

    const colonIndex = trimmedPair.indexOf(":")
    if (colonIndex === -1) {
      consola.warn(
        `Invalid model mapping format: "${trimmedPair}". Expected "source:target"`,
      )
      continue
    }

    const source = trimmedPair.slice(0, colonIndex).trim()
    const target = trimmedPair.slice(colonIndex + 1).trim()

    if (!source || !target) {
      consola.warn(
        `Invalid model mapping: "${trimmedPair}". Both source and target must be non-empty`,
      )
      continue
    }

    mappings.set(source, target)
  }

  return mappings
}

/**
 * Apply model mapping if the requested model matches a mapping.
 * Returns the mapped model name and whether a mapping was applied.
 */
export function applyModelMapping(
  modelName: string,
  mappings: Map<string, string>,
  verbose: boolean = false,
): { model: string; mapped: boolean } {
  const mappedModel = mappings.get(modelName)

  if (mappedModel) {
    if (verbose) {
      consola.warn(`Model mapping applied: "${modelName}" -> "${mappedModel}"`)
    }
    return { model: mappedModel, mapped: true }
  }

  return { model: modelName, mapped: false }
}

const CLAUDE_FAMILIES = ["opus", "sonnet", "haiku"] as const
type ClaudeFamily = (typeof CLAUDE_FAMILIES)[number]

interface ParsedClaudeModel {
  family: ClaudeFamily
  version: string
}

/**
 * Parse a Claude model id into its family and numeric version, regardless of
 * the naming style used by the caller:
 *   - Anthropic / Claude Code: "claude-opus-4-6", "claude-sonnet-4-5-20250929"
 *   - legacy Anthropic:        "claude-3-5-haiku-20241022", "claude-3-opus-20240229"
 *   - GitHub Copilot ids:      "claude-opus-4.6", "claude-haiku-4.5"
 * An 8-digit date token (e.g. 20250514) is ignored. Returns undefined for
 * non-Claude models or when no version number is present.
 */
function parseClaudeModel(name: string): ParsedClaudeModel | undefined {
  const lower = name.toLowerCase()
  if (!lower.startsWith("claude")) return undefined

  const family = CLAUDE_FAMILIES.find((f) => lower.includes(f))
  if (!family) return undefined

  const numericTokens = lower
    .split(/[-_.]/)
    .filter((token) => /^\d+$/.test(token) && token.length !== 8)

  if (numericTokens.length === 0) return undefined

  return { family, version: numericTokens.join(".") }
}

/** Compare two dotted numeric versions ("4.6" vs "4.10"). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Resolve a requested model name to an id that the Copilot backend actually
 * serves, using the live list of available model ids. No configuration needed.
 *
 * Resolution order:
 *   1. exact match against an available id
 *   2. normalized match (date stripped, "4-6" -> "4.6", legacy ordering)
 *   3. same-family fallback: exact version, otherwise the highest available
 *      version in that family
 *   4. otherwise the requested name is returned unchanged
 */
export function resolveModel(
  requested: string,
  availableIds: Array<string>,
  verbose: boolean = false,
): { model: string; mapped: boolean } {
  const noChange = { model: requested, mapped: false }
  if (!requested || availableIds.length === 0) return noChange

  if (availableIds.includes(requested)) return noChange

  const parsed = parseClaudeModel(requested)
  if (!parsed) return noChange

  const result = (target: string) => {
    if (target === requested) return noChange
    if (verbose) {
      consola.warn(`Model auto-mapped: "${requested}" -> "${target}"`)
    }
    return { model: target, mapped: true }
  }

  const canonical = `claude-${parsed.family}-${parsed.version}`
  if (availableIds.includes(canonical)) return result(canonical)

  // Prefer "clean" ids (no extra suffix like "-1m" / "-high") of the same family.
  const familyCandidates = availableIds
    .map((id) => ({ id, parsed: parseClaudeModel(id) }))
    .filter(
      (c): c is { id: string; parsed: ParsedClaudeModel } =>
        c.parsed?.family === parsed.family,
    )

  const cleanCandidates = familyCandidates.filter(
    (c) => c.id === `claude-${c.parsed.family}-${c.parsed.version}`,
  )
  const pool = cleanCandidates.length > 0 ? cleanCandidates : familyCandidates
  if (pool.length === 0) return noChange

  const exact = pool.find((c) => c.parsed.version === parsed.version)
  if (exact) return result(exact.id)

  const highest = [...pool].sort((a, b) =>
    compareVersions(b.parsed.version, a.parsed.version),
  )[0]
  return result(highest.id)
}

/**
 * Get model mappings from environment variable.
 * Caches the parsed result for performance.
 */
let cachedMappings: Map<string, string> | null = null
let cachedEnvValue: string | undefined

export function getModelMappings(): Map<string, string> {
  const envValue = process.env.MODEL_MAPPINGS

  // Return cached mappings if env value hasn't changed
  if (cachedMappings !== null && cachedEnvValue === envValue) {
    return cachedMappings
  }

  cachedEnvValue = envValue
  cachedMappings = parseModelMappings(envValue)

  if (cachedMappings.size > 0) {
    consola.info(`Loaded ${cachedMappings.size} model mapping(s)`)
  }

  return cachedMappings
}

/**
 * Clear the cached model mappings (useful for testing)
 */
export function clearModelMappingsCache(): void {
  cachedMappings = null
  cachedEnvValue = undefined
}
