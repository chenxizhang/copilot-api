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
      consola.warn(`Invalid model mapping format: "${trimmedPair}". Expected "source:target"`)
      continue
    }

    const source = trimmedPair.slice(0, colonIndex).trim()
    const target = trimmedPair.slice(colonIndex + 1).trim()

    if (!source || !target) {
      consola.warn(`Invalid model mapping: "${trimmedPair}". Both source and target must be non-empty`)
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
