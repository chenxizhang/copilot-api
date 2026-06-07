#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_SMALL_MODEL,
  DEFAULT_CODEX_MODEL,
  proxyBaseUrl,
  writeClaudeSettings,
  writeCodexConfig,
  type ConfigOptions,
} from "./lib/agent-config"
import { ensurePaths } from "./lib/paths"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"

interface RunConfigOptions {
  host: string
  port: number
  codexModel: string
  claudeModel: string
  claudeSmallModel: string
  claude: boolean
  codex: boolean
  interactive: boolean
}

async function pickModel(message: string, fallback: string): Promise<string> {
  const ids = state.models?.data.map((model) => model.id) ?? []
  if (ids.length === 0) return fallback
  const selected = await consola.prompt(message, {
    type: "select",
    options: ids,
    initial: ids.includes(fallback) ? fallback : ids[0],
  })
  return selected
}
export async function runConfig(options: RunConfigOptions): Promise<void> {
  const doClaude = options.claude || !options.codex
  const doCodex = options.codex || !options.claude

  let { codexModel } = options
  const { claudeModel, claudeSmallModel } = options

  if (options.interactive && doCodex) {
    await ensurePaths()
    await cacheVSCodeVersion()
    await setupGitHubToken()
    await setupCopilotToken()
    await cacheModels()
    // Only Codex needs a model chosen; Claude Code models are auto-mapped.
    codexModel = await pickModel("Select a model for Codex CLI", codexModel)
  }

  const baseUrl = proxyBaseUrl(options.host, options.port)
  const configOptions: ConfigOptions = {
    baseUrl,
    codexModel,
    claudeModel,
    claudeSmallModel,
  }

  if (doCodex) {
    const written = await writeCodexConfig(configOptions)
    consola.success(
      `Configured Codex CLI (model "${codexModel}") at ${written}`,
    )
  }

  if (doClaude) {
    const written = await writeClaudeSettings(configOptions)
    consola.success(`Configured Claude Code at ${written}`)
  }

  consola.box(
    [
      `Both tools now route through ${baseUrl}.`,
      ``,
      `Next steps:`,
      `  1. Log in once on this machine:  copilot-api auth`,
      `  2. Start the proxy:              copilot-api start --port ${options.port}`,
      `  3. Run codex or claude as usual.`,
    ].join("\n"),
  )
}

export const config = defineCommand({
  meta: {
    name: "config",
    description:
      "Write Codex CLI and Claude Code config files so they use this proxy",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port the proxy listens on",
    },
    host: {
      type: "string",
      default: "localhost",
      description: "Host the proxy listens on",
    },
    claude: {
      type: "boolean",
      default: false,
      description: "Only configure Claude Code (default: configure both)",
    },
    codex: {
      type: "boolean",
      default: false,
      description: "Only configure Codex CLI (default: configure both)",
    },
    interactive: {
      alias: "i",
      type: "boolean",
      default: false,
      description:
        "Pick models from the live model list (requires GitHub login)",
    },
    "codex-model": {
      type: "string",
      default: DEFAULT_CODEX_MODEL,
      description: "Model to use for Codex CLI",
    },
    "claude-model": {
      type: "string",
      default: DEFAULT_CLAUDE_MODEL,
      description:
        "Pin a Claude Code model (optional; default: let the proxy auto-map)",
    },
    "claude-small-model": {
      type: "string",
      default: DEFAULT_CLAUDE_SMALL_MODEL,
      description: "Pin a Claude Code small/fast model (optional)",
    },
  },
  run({ args }) {
    return runConfig({
      host: args.host,
      port: Number.parseInt(args.port, 10),
      codexModel: args["codex-model"],
      claudeModel: args["claude-model"],
      claudeSmallModel: args["claude-small-model"],
      claude: args.claude,
      codex: args.codex,
      interactive: args.interactive,
    })
  },
})
