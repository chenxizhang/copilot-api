import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import {
  applyModelMapping,
  getModelMappings,
  resolveModel,
} from "~/lib/model-mapping"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { StreamTracer, traceRequest, traceResponse } from "~/lib/trace"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Resolve the requested model to an id the Copilot backend serves.
  // Explicit MODEL_MAPPINGS take precedence; otherwise auto-map against the
  // live model list so no configuration is required.
  const mappings = getModelMappings()
  const explicit =
    mappings.size > 0 ?
      applyModelMapping(payload.model, mappings, state.verbose)
    : { model: payload.model, mapped: false }
  const resolved =
    explicit.mapped ? explicit : (
      resolveModel(
        payload.model,
        state.models?.data.map((m) => m.id) ?? [],
        state.verbose,
      )
    )
  if (resolved.model !== payload.model) {
    payload = { ...payload, model: resolved.model }
  }

  // Trace the request
  const traceTimestamp = await traceRequest(payload)

  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    // Trace the non-streaming response
    await traceResponse(response, traceTimestamp)
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    const streamTracer = new StreamTracer(traceTimestamp)
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      streamTracer.addChunk(chunk)
      await stream.writeSSE(chunk as SSEMessage)
    }
    await streamTracer.finish()
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
