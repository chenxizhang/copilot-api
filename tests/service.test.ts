import { describe, expect, test } from "bun:test"

import {
  buildSystemdUnit,
  buildWindowsTaskXml,
  startCommandArgs,
  type ServiceTarget,
} from "../src/lib/service"

const target: ServiceTarget = {
  port: 4141,
  accountType: "enterprise",
  runtimePath: "/usr/bin/node",
  scriptPath: "/home/me/app/dist/main.js",
}

describe("startCommandArgs", () => {
  test("builds the start command with port and account type", () => {
    expect(startCommandArgs(target)).toEqual([
      "start",
      "--port",
      "4141",
      "--account-type",
      "enterprise",
    ])
  })
})

describe("buildSystemdUnit", () => {
  const unit = buildSystemdUnit(target)

  test("restarts always and starts on boot target", () => {
    expect(unit).toContain("Restart=always")
    expect(unit).toContain("WantedBy=default.target")
  })

  test("execs the runtime with the resolved script and args", () => {
    expect(unit).toContain(
      `ExecStart="/usr/bin/node" "/home/me/app/dist/main.js" start --port 4141 --account-type enterprise`,
    )
  })
})

describe("buildWindowsTaskXml", () => {
  const xml = buildWindowsTaskXml(target)

  test("is valid-looking task XML with a logon trigger", () => {
    expect(xml).toContain("<?xml")
    expect(xml).toContain("<LogonTrigger>")
  })

  test("restarts on failure and never times out", () => {
    expect(xml).toContain("<RestartOnFailure>")
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>")
  })

  test("runs the runtime with the script and start args", () => {
    expect(xml).toContain("<Command>/usr/bin/node</Command>")
    expect(xml).toContain(
      `<Arguments>"/home/me/app/dist/main.js" start --port 4141 --account-type enterprise</Arguments>`,
    )
  })

  test("scopes the task to the given user so it installs without admin", () => {
    const scoped = buildWindowsTaskXml(target, String.raw`MYPC\me`)
    expect(scoped).toContain(String.raw`<UserId>MYPC\me</UserId>`)
    // present in both the trigger and the principal
    expect(scoped.match(/<UserId>MYPC\\me<\/UserId>/g)?.length).toBe(2)
  })
})
