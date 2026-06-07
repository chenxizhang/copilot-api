// Copilot's `/responses` endpoint is stateless: it rejects both
// `previous_response_id` and `store` ("... is not supported"). Clients such as
// the Microsoft Agent Framework rely on the OpenAI Responses API server-side
// state, sending only the delta items plus a `previous_response_id` on each
// follow-up turn (especially around tool calls).
//
// To bridge the gap we keep a small in-memory conversation store. For every
// response we remember the full item list that produced it (prior items +
// current input + the model output). When a later request references that
// response via `previous_response_id`, we prepend the stored items to the new
// input so the backend receives the complete conversation.

const MAX_CONVERSATIONS = 500

// Maps a response id to the cumulative list of Responses API items
// (input + output) representing the conversation up to and including it.
const conversations = new Map<string, Array<unknown>>()

export type ResponseInput = string | Array<unknown> | undefined

// Convert the `input` field (string or item array) into an item array so it
// can be concatenated with stored conversation history.
export function normalizeInputToItems(input: ResponseInput): Array<unknown> {
  if (input === undefined) return []
  if (typeof input === "string") {
    return [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: input }],
      },
    ]
  }
  return [...input]
}

export function getConversation(
  previousResponseId: string,
): Array<unknown> | undefined {
  return conversations.get(previousResponseId)
}

export function saveConversation(id: string, items: Array<unknown>): void {
  // Refresh insertion order so the most recently used ids are evicted last.
  if (conversations.has(id)) conversations.delete(id)
  conversations.set(id, items)

  while (conversations.size > MAX_CONVERSATIONS) {
    const oldest = conversations.keys().next().value
    if (oldest === undefined) break
    conversations.delete(oldest)
  }
}
