# Copilot API Proxy

## What is this?

A small local server that lets you use your **GitHub Copilot subscription** as the backend for AI coding tools like [Codex CLI](https://github.com/openai/codex) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview).

It exposes Copilot through OpenAI- and Anthropic-compatible APIs, so those tools talk to the proxy instead of paying for separate API keys. The proxy logs in once and refreshes your Copilot token automatically.

## Requirements

- A GitHub account with an active **Copilot** subscription (individual, business, or enterprise)
- [Node.js](https://nodejs.org) 20+ (so you can run `npx`)

## Quick start

On any machine, run a single command:

```sh
npx @daomar/copilot-api@latest setup
```

This will:

1. **Log you in** to GitHub (it shows a code to enter in your browser). You only do this once per machine.
2. **Configure your tools** — it writes config for Codex CLI and Claude Code so they use the proxy. The config files are created even if those tools aren't installed yet, so they'll just work once you install them. Existing settings are kept (and backed up to `*.bak`).
3. **Run it in the background, always** — it installs a service that starts on boot and restarts if it crashes, listening on `http://localhost:4141`:
   - **Linux** — a `systemd` user service
   - **Windows** — a Scheduled Task

That's it. Open Codex or Claude Code and they'll use your Copilot subscription.

### Setup questions

`setup` asks a few questions; press Enter to accept the defaults:

- **Account type** — `individual`, `business`, or `enterprise` (match your Copilot plan)
- **Port** — defaults to `4141`
- **Which tools to configure** — Codex, Claude Code, or both
- **Which models to use**
- **Whether to install the background service**

To skip all questions and accept defaults:

```sh
npx @daomar/copilot-api@latest setup --yes --account-type enterprise
```

Re-running `setup` any time is safe — it updates your config and refreshes the service.

## Using your tools

After setup, just use the tools as normal:

- **Codex CLI** — `codex` uses the `copilot` provider on port 4141. Note the GPT‑5.x codex models (e.g. `gpt-5.5`, `gpt-5.3-codex`) are served here too.
- **Claude Code** — `claude` is pointed at the proxy via `~/.claude/settings.json`.

To change the model later, edit `~/.codex/config.toml` (Codex) or `~/.claude/settings.json` (Claude Code), or just re-run `setup`.

## Managing the background service

**Linux (systemd):**

```sh
systemctl --user status copilot-api     # check status
systemctl --user restart copilot-api    # restart
systemctl --user stop copilot-api       # stop
systemctl --user disable --now copilot-api   # remove from startup
```

**Windows (Task Scheduler):** manage the `CopilotAPI` task in the Task Scheduler app, or:

```sh
schtasks /Run /TN CopilotAPI      # start now
schtasks /End /TN CopilotAPI      # stop
schtasks /Delete /TN CopilotAPI /F  # remove
```

## Other commands

You usually only need `setup`, but these are available via `npx @daomar/copilot-api@latest <command>`:

| Command       | What it does                                                                 |
| ------------- | ---------------------------------------------------------------------------- |
| `setup`       | Guided login + configure tools + install the background service (recommended) |
| `start`       | Run the proxy in the foreground (e.g. `start --port 4141`)                    |
| `config`      | Just write/update the Codex and Claude Code config files (no service)        |
| `auth`        | Just log in to GitHub                                                         |
| `check-usage` | Show your Copilot usage and quota in the terminal                            |
| `debug`       | Show diagnostic info for troubleshooting                                     |

Useful `start` / `setup` options: `--port <n>` (default 4141), `--account-type <individual|business|enterprise>`, `--codex` / `--claude` (configure only one), `--no-service` (setup without the background service).

## Configure manually (optional)

If you'd rather not use `setup`, you can point the tools at a running proxy yourself.

**Codex CLI** — add to `~/.codex/config.toml`:

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

**Claude Code** — add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "ANTHROPIC_MODEL": "claude-sonnet-4.5",
    "ANTHROPIC_SMALL_FAST_MODEL": "claude-haiku-4.5"
  }
}
```

Then run `npx @daomar/copilot-api@latest start`.

## Monitor your usage

See your Copilot quota and usage anytime:

```sh
npx @daomar/copilot-api@latest check-usage
```

Or open the web dashboard: <https://ericc-ch.github.io/copilot-api?endpoint=http://localhost:4141/usage> (while the proxy is running).

## Troubleshooting

- **Run `npx @daomar/copilot-api@latest debug`** to see version, paths, and login status.
- **Port already in use?** Pick another with `setup --port 5151` (and re-run your tools' config, or just re-run `setup`).
- **Need to log in again?** Run `npx @daomar/copilot-api@latest auth`.
