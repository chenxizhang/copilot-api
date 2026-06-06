import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import {
  applyModelMapping,
  getModelMappings,
  resolveModel,
} from "~/lib/model-mapping"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { StreamTracer, traceRequest, traceResponse } from "~/lib/trace"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  // Resolve the requested model to an id the Copilot backend serves.
  // Explicit MODEL_MAPPINGS take precedence; otherwise auto-map against the
  // live model list so no configuration is required.
  const mappings = getModelMappings()
  const explicit =
    mappings.size > 0 ?
      applyModelMapping(anthropicPayload.model, mappings, state.verbose)
    : { model: anthropicPayload.model, mapped: false }
  const resolved =
    explicit.mapped ? explicit : (
      resolveModel(
        anthropicPayload.model,
        state.models?.data.map((m) => m.id) ?? [],
        state.verbose,
      )
    )
  if (resolved.model !== anthropicPayload.model) {
    anthropicPayload = { ...anthropicPayload, model: resolved.model }
  }

  // Trace the original Anthropic request
  const traceTimestamp = await traceRequest({
    type: "anthropic",
    original: anthropicPayload,
  })

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    // Trace the response (both OpenAI and translated Anthropic)
    await traceResponse(
      {
        type: "anthropic",
        openai: response,
        translated: anthropicResponse,
      },
      traceTimestamp,
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    const streamTracer = new StreamTracer(traceTimestamp)

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        streamTracer.addChunk({ openai: chunk, anthropic: event })
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }

    await streamTracer.finish()
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
