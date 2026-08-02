import { describe, expect, test } from "bun:test"

import {
  buildClaudeSettings,
  buildCodexConfig,
  upsertCodexProvider,
  upsertTopLevelKey,
} from "../src/lib/agent-config"

const options = {
  baseUrl: "http://localhost:4141",
  codexModel: "gpt-5.5",
  claudeModel: "claude-sonnet-4.5",
  claudeSmallModel: "claude-haiku-4.5",
}

describe("upsertTopLevelKey", () => {
  test("inserts a missing key at the top", () => {
    const result = upsertTopLevelKey("[section]\nx = 1", {
      key: "model",
      value: `"a"`,
      override: false,
    })
    expect(result).toBe(`model = "a"\n[section]\nx = 1`)
  })

  test("preserves an existing key when override is false", () => {
    const result = upsertTopLevelKey(`model = "kept"\n`, {
      key: "model",
      value: `"new"`,
      override: false,
    })
    expect(result).toBe(`model = "kept"\n`)
  })

  test("rewrites an existing key when override is true", () => {
    const result = upsertTopLevelKey(`model="old"\n`, {
      key: "model",
      value: `"new"`,
      override: true,
    })
    expect(result).toBe(`model = "new"\n`)
  })

  test("does not treat a key inside a table as top-level", () => {
    const input = `[t]\nmodel = "inside"`
    const result = upsertTopLevelKey(input, {
      key: "model",
      value: `"x"`,
      override: true,
    })
    expect(result).toBe(`model = "x"\n[t]\nmodel = "inside"`)
  })

  test("does not match a key that is only a prefix", () => {
    const input = `model_provider = "copilot"\n`
    const result = upsertTopLevelKey(input, {
      key: "model",
      value: `"x"`,
      override: false,
    })
    expect(result).toBe(`model = "x"\nmodel_provider = "copilot"\n`)
  })
})

describe("upsertCodexProvider", () => {
  const block = `[model_providers.copilot]\nname = "GitHub Copilot"`

  test("appends when no copilot provider exists", () => {
    const result = upsertCodexProvider(`model = "x"`, block)
    expect(result).toBe(`model = "x"\n\n${block}\n`)
  })

  test("replaces an existing provider including sub-tables", () => {
    const input = [
      `[model_providers.copilot]`,
      `base_url = "https://api.githubcopilot.com"`,
      ``,
      `[model_providers.copilot.auth]`,
      `command = "old.sh"`,
      ``,
      `[notice]`,
      `hide = true`,
    ].join("\n")

    const result = upsertCodexProvider(input, block)

    expect(result).not.toContain("copilot.auth")
    expect(result).not.toContain("old.sh")
    expect(result).toContain(block)
    expect(result).toContain("[notice]")
    expect(result).toContain("hide = true")
  })

  test("keeps comments that belong to the following section", () => {
    const input = [
      `[model_providers.copilot]`,
      `base_url = "x"`,
      ``,
      `# comment for notice`,
      `[notice]`,
      `hide = true`,
    ].join("\n")

    const result = upsertCodexProvider(input, block)
    expect(result).toContain("# comment for notice\n[notice]")
  })
})

describe("buildCodexConfig", () => {
  test("sets provider, keeps existing model, points at proxy", () => {
    const input = `model = "gpt-5.5"\nmodel_provider = "azure"\n`
    const result = buildCodexConfig(input, options)

    expect(result).toContain(`model = "gpt-5.5"`)
    expect(result).toContain(`model_provider = "copilot"`)
    expect(result).not.toContain(`model_provider = "azure"`)
    expect(result).toContain(`base_url = "http://localhost:4141/v1"`)
    expect(result).toContain(`wire_api = "responses"`)
    expect(result).not.toContain("requires_openai_auth = true")
  })

  test("creates a full config from scratch", () => {
    const result = buildCodexConfig("", options)
    expect(result).toContain(`model = "gpt-5.5"`)
    expect(result).toContain(`model_provider = "copilot"`)
    expect(result).toContain(`[model_providers.copilot]`)
  })
})

describe("buildClaudeSettings", () => {
  test("always sets base url and auth token", () => {
    const result = buildClaudeSettings({}, options)
    expect(result.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:4141")
    expect(result.env?.ANTHROPIC_AUTH_TOKEN).toBe("dummy")
    expect(result.permissions).toEqual({ defaultMode: "bypassPermissions" })
  })

  test("does not pin any model when models are empty (proxy auto-maps)", () => {
    const result = buildClaudeSettings(
      {},
      { ...options, claudeModel: "", claudeSmallModel: "" },
    )
    expect(result.env?.ANTHROPIC_MODEL).toBeUndefined()
    expect(result.env?.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined()
    expect(result.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
  })

  test("pins models (incl. aliases) only when explicitly provided", () => {
    const result = buildClaudeSettings({}, options)
    expect(result.env?.ANTHROPIC_MODEL).toBe("claude-sonnet-4.5")
    expect(result.env?.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-sonnet-4.5")
    expect(result.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-4.5")
    expect(result.env?.ANTHROPIC_SMALL_FAST_MODEL).toBe("claude-haiku-4.5")
    expect(result.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-haiku-4.5")
  })

  test("overrides an existing base url, preserves permission rules, and forces bypass mode", () => {
    const existing = {
      env: {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_MODEL: "my-model",
      },
      permissions: {
        defaultMode: "default",
        deny: ["WebSearch"],
      },
    }
    const result = buildClaudeSettings(existing, options)

    expect(result.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:4141")
    expect(result.env?.ANTHROPIC_MODEL).toBe("my-model")
    expect(result.permissions).toEqual({
      defaultMode: "bypassPermissions",
      deny: ["WebSearch"],
    })
  })
})
