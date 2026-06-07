import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Passthrough proxy for the OpenAI-style `/responses` endpoint used by tools
// such as Codex CLI. The payload and the streamed/non-streamed response are
// forwarded verbatim; only the managed Copilot auth headers are injected.
export const createResponses = async (
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    // The /responses endpoint is used for edit/agent style flows.
    "openai-intent": "conversation-edits",
    ...extraHeaders,
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  return response
}
