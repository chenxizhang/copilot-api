# Copilot API Proxy

Use your **GitHub Copilot subscription** as the backend for [Codex CLI](https://github.com/openai/codex) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

## One command

```sh
npx -y @daomar/copilot-api@latest setup
```

That's the whole setup. It logs you into GitHub (once per machine), writes config for Codex CLI and Claude Code, and installs a background service on `http://localhost:4141` that starts on boot (systemd user unit on Linux, `CopilotAPI` scheduled task on Windows).

Then just run `codex` or `claude` as usual.

Requirements: a GitHub account with active Copilot, and [Node.js](https://nodejs.org) 20+.

## Notes

- `setup` asks a few questions (account type, port, which tools, models, service). Press Enter for defaults, or skip them all:
  ```sh
  npx -y @daomar/copilot-api@latest setup --yes --account-type enterprise
  ```
- Re-running `setup` is always safe — it updates config and refreshes the service. Existing settings are backed up to `*.bak`.
- No need to pin models: the proxy maps whatever Opus/Sonnet/Haiku or GPT‑5.x model your tool requests onto an available Copilot model.
- Options: `--port <n>` (default 4141), `--account-type <individual|business|enterprise>`, `--codex` / `--claude`, `--no-service`.

## Other commands

Run via `npx -y @daomar/copilot-api@latest <command>`:

| Command       | What it does                                             |
| ------------- | -------------------------------------------------------- |
| `start`       | Run the proxy in the foreground                          |
| `config`      | Write the Codex / Claude Code config only (no service)   |
| `auth`        | Log in to GitHub again                                   |
| `check-usage` | Show your Copilot usage and quota                        |
| `debug`       | Version, paths, and login status for troubleshooting     |

## Managing the background service

```sh
# Linux
systemctl --user status|restart|stop copilot-api
systemctl --user disable --now copilot-api   # remove from startup

# Windows
schtasks /Run|/End /TN CopilotAPI
schtasks /Delete /TN CopilotAPI /F
```

## Manual configuration (optional)

If you'd rather not use `setup`, run `npx -y @daomar/copilot-api@latest start` and point your tools at it.

**Codex CLI** — `~/.codex/config.toml`:

```toml
model = "gpt-5.5"
model_provider = "copilot"

[model_providers.copilot]
name = "GitHub Copilot"
base_url = "http://localhost:4141/v1"
wire_api = "responses"
requires_openai_auth = false
http_headers = { "Openai-Intent" = "conversation-edits", "x-initiator" = "user" }
```

**Claude Code** — `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "dummy"
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

## Usage dashboard

`check-usage` in the terminal, or the web view: <https://ericc-ch.github.io/copilot-api?endpoint=http://localhost:4141/usage> (while the proxy is running).
