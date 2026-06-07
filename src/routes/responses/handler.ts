import type { Context } from "hono"

import consola from "consola"
import { events } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import {
  getConversation,
  normalizeInputToItems,
  saveConversation,
  type ResponseInput,
} from "~/lib/responses-state"
import { state } from "~/lib/state"
import { createResponses } from "~/services/copilot/create-responses"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<Record<string, unknown>>()
  consola.debug(
    "Responses request payload:",
    JSON.stringify(payload).slice(-400),
  )

  if (state.manualApprove) await awaitApproval()

  // Copilot's /responses endpoint is stateless and rejects `previous_response_id`
  // and `store`. Reconstruct the conversation locally so stateful clients (e.g.
  // the Agent Framework) work, then strip the unsupported fields.
  const previousResponseId =
    typeof payload.previous_response_id === "string" ?
      payload.previous_response_id
    : undefined

  const priorItems =
    previousResponseId ? (getConversation(previousResponseId) ?? []) : []
  const currentItems = normalizeInputToItems(payload.input as ResponseInput)
  const combinedInput = [...priorItems, ...currentItems]

  payload.input = combinedInput
  delete payload.previous_response_id
  delete payload.store

  // Preserve the initiator hint from the caller when present.
  const initiator = c.req.header("x-initiator")
  const extraHeaders: Record<string, string> =
    initiator ? { "x-initiator": initiator } : {}

  const response = await createResponses(payload, extraHeaders)

  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("text/event-stream")) {
    consola.debug("Streaming responses response")
    return streamSSE(c, async (stream) => {
      let completedId: string | undefined
      let completedOutput: Array<unknown> | undefined

      for await (const event of events(response)) {
        if (event.data) {
          try {
            const parsed = JSON.parse(event.data) as {
              type?: string
              response?: { id?: string; output?: Array<unknown> }
            }
            if (parsed.type === "response.completed" && parsed.response) {
              completedId = parsed.response.id
              completedOutput = parsed.response.output
            }
          } catch {
            // Non-JSON event payloads are forwarded as-is.
          }
        }

        await stream.writeSSE({
          data: event.data ?? "",
          event: event.event,
          id: event.id === undefined ? undefined : String(event.id),
        })
      }

      if (completedId && completedOutput) {
        saveConversation(completedId, [...combinedInput, ...completedOutput])
      }
    })
  }

  const json = (await response.json()) as {
    id?: string
    output?: Array<unknown>
  }
  consola.debug("Non-streaming responses response")
  if (json.id && json.output) {
    saveConversation(json.id, [...combinedInput, ...json.output])
  }
  return c.json(json)
}
