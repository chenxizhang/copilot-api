#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"
import fs from "node:fs"
import process from "node:process"

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
import { installService, type ServiceTarget } from "./lib/service"
import { state } from "./lib/state"
import { setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { getCopilotToken } from "./services/github/get-copilot-token"

interface RunSetupOptions {
  port: number
  host: string
  accountType: string
  codexModel: string
  claudeModel: string
  claudeSmallModel: string
  claude: boolean
  codex: boolean
  service: boolean
  yes: boolean
  showToken: boolean
}

const ACCOUNT_TYPES = ["individual", "business", "enterprise"]

const resolveRuntime = (): { runtimePath: string; scriptPath: string } => {
  let scriptPath = process.argv[1] ?? ""
  try {
    scriptPath = fs.realpathSync(scriptPath)
  } catch {
    // Fall back to the raw argv value if it cannot be resolved.
  }
  return { runtimePath: process.execPath, scriptPath }
}

async function loadModelIds(accountType: string): Promise<Array<string>> {
  state.accountType = accountType
  await cacheVSCodeVersion()
  const { token } = await getCopilotToken()
  state.copilotToken = token
  await cacheModels()
  return state.models?.data.map((model) => model.id) ?? []
}

async function pickModel(
  message: string,
  ids: Array<string>,
  fallback: string,
): Promise<string> {
  if (ids.length === 0) return fallback
  const selected = await consola.prompt(message, {
    type: "select",
    options: ids,
    initial: ids.includes(fallback) ? fallback : ids[0],
  })
  return selected
}

interface SetupChoices {
  port: number
  accountType: string
  doClaude: boolean
  doCodex: boolean
}

async function promptChoices(initial: SetupChoices): Promise<SetupChoices> {
  const accountType = await consola.prompt("GitHub Copilot account type", {
    type: "select",
    options: ACCOUNT_TYPES,
    initial:
      ACCOUNT_TYPES.includes(initial.accountType) ?
        initial.accountType
      : "individual",
  })

  const portInput = await consola.prompt("Port for the proxy", {
    type: "text",
    default: String(initial.port),
    placeholder: String(initial.port),
  })
  const parsedPort = Number.parseInt(portInput, 10)

  const doCodex = await consola.prompt("Configure Codex CLI?", {
    type: "confirm",
    initial: initial.doCodex,
  })
  const doClaude = await consola.prompt("Configure Claude Code?", {
    type: "confirm",
    initial: initial.doClaude,
  })

  return {
    accountType,
    port: Number.isNaN(parsedPort) ? initial.port : parsedPort,
    doCodex,
    doClaude,
  }
}

async function promptModels(
  choices: SetupChoices,
  models: ConfigOptions,
): Promise<ConfigOptions> {
  // Only Codex needs a model chosen; Claude Code models are auto-mapped by the
  // proxy, so they are left unset unless pinned via a flag.
  if (!choices.doCodex) return models

  let { codexModel } = models
  try {
    const ids = await loadModelIds(choices.accountType)
    codexModel = await pickModel("Model for Codex CLI", ids, codexModel)
  } catch (error) {
    consola.warn(
      `Could not load the model list, using defaults instead: ${String(error)}`,
    )
  }

  return { ...models, codexModel }
}

async function writeConfigs(
  choices: SetupChoices,
  configOptions: ConfigOptions,
): Promise<void> {
  if (choices.doCodex) {
    const written = await writeCodexConfig(configOptions)
    consola.success(
      `Configured Codex CLI (model "${configOptions.codexModel}") at ${written}`,
    )
  }
  if (choices.doClaude) {
    const written = await writeClaudeSettings(configOptions)
    consola.success(`Configured Claude Code at ${written}`)
  }
}

async function maybeInstallService(
  options: RunSetupOptions,
  choices: SetupChoices,
): Promise<void> {
  let doService = options.service
  if (!options.yes && options.service) {
    doService = await consola.prompt(
      `Install an auto-start service on port ${choices.port}?`,
      { type: "confirm", initial: true },
    )
  }
  if (!doService) return

  const { runtimePath, scriptPath } = resolveRuntime()
  const target: ServiceTarget = {
    port: choices.port,
    accountType: choices.accountType,
    runtimePath,
    scriptPath,
  }
  const result = await installService(target)
  if (result.installed) consola.success(result.message)
  else consola.warn(result.message)
}

function printSummary(options: RunSetupOptions, choices: SetupChoices): void {
  const baseUrl = proxyBaseUrl(options.host, choices.port)
  consola.box(
    [
      `Setup complete. Proxy URL: ${baseUrl}`,
      ``,
      options.service ?
        `The proxy is registered to run automatically on port ${choices.port}.`
      : `Start manually: copilot-api start --port ${choices.port} --account-type ${choices.accountType}`,
      ``,
      `Config files were written for Codex and/or Claude Code (created even if`,
      `those tools are not installed yet), so they will work once installed.`,
    ].join("\n"),
  )
}

export async function runSetup(options: RunSetupOptions): Promise<void> {
  state.showToken = options.showToken
  consola.box("copilot-api setup")

  let choices: SetupChoices = {
    port: options.port,
    accountType: options.accountType,
    doClaude: options.claude || !options.codex,
    doCodex: options.codex || !options.claude,
  }
  if (!options.yes) choices = await promptChoices(choices)

  // Require login (device flow if not already authenticated).
  await ensurePaths()
  consola.info("Checking GitHub authentication...")
  await setupGitHubToken()

  let configOptions: ConfigOptions = {
    baseUrl: proxyBaseUrl(options.host, choices.port),
    codexModel: options.codexModel,
    claudeModel: options.claudeModel,
    claudeSmallModel: options.claudeSmallModel,
  }
  if (!options.yes) configOptions = await promptModels(choices, configOptions)

  await writeConfigs(choices, configOptions)
  await maybeInstallService(options, choices)
  printSummary(options, choices)

  // setupGitHubToken / model fetch may keep the event loop busy; exit cleanly.
  process.exit(0)
}

export const setup = defineCommand({
  meta: {
    name: "setup",
    description:
      "Guided setup: log in, configure Codex/Claude Code, and install an auto-start service",
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
      description: "Host the config files point at",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type (individual, business, enterprise)",
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
    service: {
      type: "boolean",
      default: true,
      description: "Install an auto-start service (use --no-service to skip)",
    },
    yes: {
      alias: "y",
      type: "boolean",
      default: false,
      description: "Non-interactive: accept all defaults",
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
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens during setup",
    },
  },
  run({ args }) {
    return runSetup({
      port: Number.parseInt(args.port, 10),
      host: args.host,
      accountType: args["account-type"],
      codexModel: args["codex-model"],
      claudeModel: args["claude-model"],
      claudeSmallModel: args["claude-small-model"],
      claude: args.claude,
      codex: args.codex,
      service: args.service,
      yes: args.yes,
      showToken: args["show-token"],
    })
  },
})
