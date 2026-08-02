import consola from "consola"

import { getModels } from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"

import { detectClaudeAvailability } from "./model-mapping"
import { state } from "./state"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models

  const availableIds = models.data.map((m) => m.id)
  const { claudeAvailable, fallback } = detectClaudeAvailability(availableIds)

  state.claudeAvailable = claudeAvailable
  state.claudeFallback = fallback

  if (!claudeAvailable) {
    if (fallback.size > 0) {
      const lines = [...fallback.entries()]
        .map(([family, gptId]) => `  claude-${family} → ${gptId}`)
        .join("\n")
      consola.warn(
        `Claude models not available in this region. Auto-routing Claude requests:\n${lines}`,
      )
    } else {
      consola.warn(
        "Claude models not available in this region and no GPT-5.6 fallback models found.",
      )
    }
  }
}

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response

  consola.info(`Using VSCode version: ${response}`)
}
