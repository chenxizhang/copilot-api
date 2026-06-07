import consola from "consola"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const CODEX_CONFIG_PATH = path.join(
  os.homedir(),
  ".codex",
  "config.toml",
)

export const CLAUDE_SETTINGS_PATH = path.join(
  os.homedir(),
  ".claude",
  "settings.json",
)

export const DEFAULT_CODEX_MODEL = "gpt-5.5"
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4.5"
export const DEFAULT_CLAUDE_SMALL_MODEL = "claude-haiku-4.5"

export interface ConfigOptions {
  baseUrl: string
  codexModel: string
  claudeModel: string
  claudeSmallModel: string
}

export const proxyBaseUrl = (host: string, port: number): string =>
  `http://${host}:${port}`

// --- Codex (TOML) helpers ---

// The Codex `copilot` provider points at the proxy's OpenAI Responses
// endpoint. Auth is intentionally omitted: the proxy manages and refreshes
// the Copilot token itself.
export function buildCodexProviderBlock(baseUrl: string): string {
  return [
    `[model_providers.copilot]`,
    `name = "GitHub Copilot"`,
    `base_url = "${baseUrl}/v1"`,
    `wire_api = "responses"`,
    `requires_openai_auth = false`,
    `http_headers = { "Openai-Intent" = "conversation-edits", "x-initiator" = "user" }`,
  ].join("\n")
}

const tableHeaderKey = (line: string): string | null => {
  const match = /^\s*\[([^[\]]+)\]\s*$/.exec(line)
  return match ? match[1].trim() : null
}

const isCopilotProviderTable = (key: string): boolean =>
  key === "model_providers.copilot"
  || key.startsWith("model_providers.copilot.")

const firstTableIndex = (lines: Array<string>): number => {
  const index = lines.findIndex((line) => tableHeaderKey(line) !== null)
  return index === -1 ? lines.length : index
}

export interface TopLevelKeyUpdate {
  key: string
  value: string
  override: boolean
}

// Inserts or updates a top-level (pre-table) `key = value` pair. When the key
// already exists before the first table header it is only rewritten if
// `override` is true; otherwise the existing value is preserved.
export function upsertTopLevelKey(
  content: string,
  update: TopLevelKeyUpdate,
): string {
  const { key, value, override } = update
  const lines = content.split("\n")
  const limit = firstTableIndex(lines)
  const keyRegex = new RegExp(`^\\s*${key}\\s*=`)

  for (let i = 0; i < limit; i++) {
    if (keyRegex.test(lines[i])) {
      if (override) lines[i] = `${key} = ${value}`
      return lines.join("\n")
    }
  }

  lines.splice(0, 0, `${key} = ${value}`)
  return lines.join("\n")
}

// Replaces the existing `[model_providers.copilot]` table (including any of its
// sub-tables such as `[model_providers.copilot.auth]`) with `block`, or appends
// `block` when no such table exists. Comments and blank lines belonging to the
// following section are preserved.
export function upsertCodexProvider(content: string, block: string): string {
  const lines = content.split("\n")

  let start = -1
  for (const [i, line] of lines.entries()) {
    if (tableHeaderKey(line) === "model_providers.copilot") {
      start = i
      break
    }
  }

  if (start === -1) {
    const trimmed = content.replace(/\n*$/, "")
    return (trimmed.length > 0 ? `${trimmed}\n\n` : "") + `${block}\n`
  }

  let end = lines.length
  for (let j = start + 1; j < lines.length; j++) {
    const key = tableHeaderKey(lines[j])
    if (key !== null && !isCopilotProviderTable(key)) {
      end = j
      break
    }
  }

  // Keep blank lines / comments that directly precede the next section with
  // that section rather than dropping them with the replaced block.
  let realEnd = end
  if (end < lines.length) {
    while (realEnd - 1 > start) {
      const prev = lines[realEnd - 1].trim()
      if (prev === "" || prev.startsWith("#")) realEnd--
      else break
    }
  }

  const beforeText = lines.slice(0, start).join("\n").replace(/\n*$/, "")
  const afterText = lines.slice(realEnd).join("\n").replace(/^\n*/, "")

  const parts: Array<string> = []
  if (beforeText.length > 0) parts.push(beforeText)
  parts.push(block)
  if (afterText.length > 0) parts.push(afterText)

  return `${parts.join("\n\n")}\n`
}

export function buildCodexConfig(
  existing: string,
  options: ConfigOptions,
): string {
  let next = existing
  next = upsertTopLevelKey(next, {
    key: "model",
    value: `"${options.codexModel}"`,
    override: false,
  })
  next = upsertTopLevelKey(next, {
    key: "model_provider",
    value: `"copilot"`,
    override: true,
  })
  next = upsertCodexProvider(next, buildCodexProviderBlock(options.baseUrl))
  return next
}

// --- Claude Code (JSON) helpers ---

interface ClaudeSettings {
  env?: Record<string, string>
  [key: string]: unknown
}

// Merges the proxy-related environment variables into an existing Claude Code
// settings object. `BASE_URL`/`AUTH_TOKEN` are always (re)written so the proxy
// is used; model and optimization keys are only filled in when absent so the
// user's existing preferences are preserved.
export function buildClaudeSettings(
  existing: ClaudeSettings,
  options: ConfigOptions,
): ClaudeSettings {
  const env: Record<string, string> = { ...existing.env }

  env.ANTHROPIC_BASE_URL = options.baseUrl
  env.ANTHROPIC_AUTH_TOKEN = "dummy"

  const defaults: Record<string, string> = {
    ANTHROPIC_MODEL: options.claudeModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: options.claudeModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: options.claudeModel,
    ANTHROPIC_SMALL_FAST_MODEL: options.claudeSmallModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: options.claudeSmallModel,
    DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(env, key)) env[key] = value
  }

  return { ...existing, env }
}

// --- IO ---

const readFileOr = async (filePath: string, fallback: string) => {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return fallback
  }
}

const backupFile = async (filePath: string) => {
  try {
    await fs.access(filePath)
  } catch {
    return
  }
  const backupPath = `${filePath}.bak`
  await fs.copyFile(filePath, backupPath)
  consola.info(`Backed up existing config to ${backupPath}`)
}

export async function writeCodexConfig(
  options: ConfigOptions,
): Promise<string> {
  await fs.mkdir(path.dirname(CODEX_CONFIG_PATH), { recursive: true })
  const existing = await readFileOr(CODEX_CONFIG_PATH, "")
  const next = buildCodexConfig(existing, options)
  if (next !== existing) await backupFile(CODEX_CONFIG_PATH)
  await fs.writeFile(CODEX_CONFIG_PATH, next)
  return CODEX_CONFIG_PATH
}

export async function writeClaudeSettings(
  options: ConfigOptions,
): Promise<string> {
  await fs.mkdir(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
  const raw = await readFileOr(CLAUDE_SETTINGS_PATH, "")

  let existing: ClaudeSettings = {}
  if (raw.trim().length > 0) {
    try {
      existing = JSON.parse(raw) as ClaudeSettings
    } catch {
      consola.warn(
        `Could not parse ${CLAUDE_SETTINGS_PATH}; it will be recreated.`,
      )
    }
  }

  const next = buildClaudeSettings(existing, options)
  if (raw.trim().length > 0) await backupFile(CLAUDE_SETTINGS_PATH)
  await fs.writeFile(CLAUDE_SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`)
  return CLAUDE_SETTINGS_PATH
}
