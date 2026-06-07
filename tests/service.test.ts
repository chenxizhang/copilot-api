import { describe, expect, test } from "bun:test"

import {
  buildSystemdUnit,
  buildVbsLauncher,
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

describe("buildVbsLauncher", () => {
  const vbs = buildVbsLauncher(target)

  test("runs the command with a hidden window (style 0)", () => {
    expect(vbs).toContain(`CreateObject("WScript.Shell")`)
    expect(vbs).toContain(`, 0, False`)
  })

  test("embeds the node command with doubled quotes for VBScript", () => {
    expect(vbs).toContain(
      `WshShell.Run """/usr/bin/node"" ""/home/me/app/dist/main.js"" start --port 4141 --account-type enterprise", 0, False`,
    )
  })
})

describe("buildWindowsTaskXml", () => {
  const xml = buildWindowsTaskXml({
    command: String.raw`C:\Windows\System32\wscript.exe`,
    arguments: String.raw`//B //Nologo "C:\Users\me\launch.vbs"`,
    userId: String.raw`MYPC\me`,
  })

  test("is valid-looking task XML with a logon trigger", () => {
    expect(xml).toContain("<?xml")
    expect(xml).toContain("<LogonTrigger>")
  })

  test("restarts on failure and never times out", () => {
    expect(xml).toContain("<RestartOnFailure>")
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>")
  })

  test("runs via wscript with the launcher script", () => {
    expect(xml).toContain(
      String.raw`<Command>C:\Windows\System32\wscript.exe</Command>`,
    )
    expect(xml).toContain(
      String.raw`<Arguments>//B //Nologo "C:\Users\me\launch.vbs"</Arguments>`,
    )
  })

  test("scopes the task to the given user so it installs without admin", () => {
    expect(xml).toContain(String.raw`<UserId>MYPC\me</UserId>`)
    // present in both the trigger and the principal
    expect(xml.match(/<UserId>MYPC\\me<\/UserId>/g)?.length).toBe(2)
  })
})
