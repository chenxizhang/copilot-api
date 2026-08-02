# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local proxy (`@daomar/copilot-api`) that exposes a user's **GitHub Copilot** subscription behind **OpenAI-** and **Anthropic-compatible** HTTP APIs, so tools like Codex CLI and Claude Code can use Copilot as their backend. Ships as an npm CLI (`copilot-api`), built with Bun + Hono.

## Commands

```sh
bun run dev          # watch mode: src/main.ts start
bun run start        # production run from source
bun run build        # tsdown -> dist/main.js (single ESM entry, node platform)
bun run lint         # eslint --cache (@echristian/eslint-config); lint:all for whole repo
bun run typecheck    # tsc (noEmit config)
bun run knip         # unused-export/dependency check
bun test                                # all tests (Bun test runner)
bun test tests/model-mapping.test.ts    # single file
bun test -t "some name"                 # single test by name
```

Pre-commit hook runs `bunx lint-staged` (eslint --fix on staged files).

## Architecture

**CLI layer** (`citty`): `src/main.ts` registers subcommands, each its own file — `auth`, `start`, `setup`, `config`, `check-usage`, `debug`. `setup.ts` is the primary UX: device-code login → writes `~/.codex/config.toml` and `~/.claude/settings.json` (backing up to `*.bak`) → installs a background service via `src/lib/service.ts` (systemd user unit on Linux, `CopilotAPI` Scheduled Task on Windows; helper shells in `scripts/`).

**Server** (`src/server.ts`, Hono, served by `srvx`): mounts each route group at both bare and `/v1`-prefixed paths for client compatibility. Anthropic surface is `/v1/messages` (+ `/count_tokens`); OpenAI surface is `/chat/completions`, `/responses`, `/models`, `/embeddings`; plus `/usage` and `/token`.

**Route → handler → service** is the consistent shape. `routes/*/route.ts` is a thin Hono router wrapping the handler in `forwardError` (`src/lib/error.ts`); `handler.ts` holds request logic; `src/services/copilot/*` and `src/services/github/*` make the actual upstream calls.

**Anthropic translation** (`src/routes/messages/`) is the most intricate part: incoming Anthropic payloads are translated to OpenAI chat-completions (`non-stream-translation.ts` → `translateToOpenAI`), sent to Copilot, then translated back — either whole (`translateToAnthropic`) or as SSE events (`stream-translation.ts`, driven by a mutable `AnthropicStreamState`). `anthropic-types.ts` is the local type source of truth. Any change to tool-call, thinking-block, or stop-reason handling needs matching updates on both the streaming and non-streaming paths.

**Model resolution** (`src/lib/model-mapping.ts`): explicit `MODEL_MAPPINGS` env pairs take precedence; otherwise `resolveModel` auto-maps a requested Claude id onto the closest id in the live Copilot model list. It normalizes across three naming styles (Claude Code `claude-opus-4-6`, legacy `claude-3-5-haiku-20241022`, Copilot `claude-opus-4.6`) and ignores 8-digit date tokens. Users should not need to pin models.

**Shared mutable state** (`src/lib/state.ts`) is a single exported `state` object — account type, tokens, cached model list, VS Code version, verbosity, rate-limit and trace config. Handlers read it directly rather than receiving config. `src/lib/token.ts` performs device-code auth, persists the GitHub token to `~/.local/share/copilot-api/github_token` (mode 0600, see `lib/paths.ts`), and self-schedules Copilot token refresh on an interval.

**Cross-cutting middleware-ish helpers** invoked at the top of handlers: `checkRateLimit` (`lib/rate-limit.ts`), `awaitApproval` (`lib/approval.ts`, `--manual` mode), and `traceRequest`/`traceResponse`/`StreamTracer` (`lib/trace.ts`, `--trace` mode).

## Conventions

- Imports from `src/` use the `~/*` path alias. ESM only, strict TS, no `any`.
- `noUnusedLocals`/`noUnusedParameters` are errors; explicit error classes in `src/lib/error.ts` — no silent failures.
- Tests live in `tests/*.test.ts` and target the translation and mapping logic (`anthropic-request`, `anthropic-response`, `model-mapping`, `create-chat-completions`, `agent-config`, `service`).

## Environment

`.env.example` documents: `TRACE_OUTPUT_FOLDER`, `IDLE_TIMEOUT` (srvx idle seconds, default 255), `MODEL_MAPPINGS` (`"source:target,source2:target2"`).
