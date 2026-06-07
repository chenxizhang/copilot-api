import type { Context } from "hono"

import consola from "consola"
import { events } from "fetch-event-stream"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
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

  // Preserve the initiator hint from the caller when present.
  const initiator = c.req.header("x-initiator")
  const extraHeaders: Record<string, string> =
    initiator ? { "x-initiator": initiator } : {}

  const response = await createResponses(payload, extraHeaders)

  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("text/event-stream")) {
    consola.debug("Streaming responses response")
    return streamSSE(c, async (stream) => {
      for await (const event of events(response)) {
        await stream.writeSSE({
          data: event.data ?? "",
          event: event.event,
          id: event.id === undefined ? undefined : String(event.id),
        })
      }
    })
  }

  const json = (await response.json()) as Record<string, unknown>
  consola.debug("Non-streaming responses response")
  return c.json(json)
}
