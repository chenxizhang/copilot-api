import consola from "consola"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { PATHS } from "./paths"

export const SERVICE_NAME = "copilot-api"
export const WINDOWS_TASK_NAME = "CopilotAPI"

export interface ServiceTarget {
  port: number
  accountType: string
  runtimePath: string
  scriptPath: string
}

export interface ServiceInstallResult {
  installed: boolean
  manager: "systemd" | "schtasks" | "none"
  message: string
}

const SERVICE_START_TIMEOUT_MS = 30_000
const SERVICE_HEALTH_INTERVAL_MS = 500

const quote = (value: string): string =>
  `"${value.replaceAll('"', String.raw`\"`)}"`

export const startCommandArgs = (target: ServiceTarget): Array<string> => [
  "start",
  "--port",
  String(target.port),
  "--account-type",
  target.accountType,
]

// --- systemd (Linux) ---

export function buildSystemdUnit(target: ServiceTarget): string {
  const exec = [
    quote(target.runtimePath),
    quote(target.scriptPath),
    ...startCommandArgs(target),
  ].join(" ")

  return `[Unit]
Description=GitHub Copilot API proxy (copilot-api)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`
}

const systemdUnitPath = () =>
  path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    `${SERVICE_NAME}.service`,
  )

const runQuietly = (
  command: string,
  args: Array<string>,
): { ok: boolean; output: string } => {
  try {
    const output = execFileSync(command, args, {
      stdio: "pipe",
      encoding: "utf8",
    })
    return { ok: true, output }
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message?: string }
    const output =
      err.stderr ? err.stderr.toString() : (err.message ?? "unknown error")
    return { ok: false, output }
  }
}

const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration))

export async function waitForService(
  port: number,
  timeout = SERVICE_START_TIMEOUT_MS,
): Promise<{ ok: boolean; error?: string }> {
  const deadline = Date.now() + timeout
  let lastError = "service did not respond"

  while (Date.now() < deadline) {
    try {
      const requestTimeout = Math.min(2_000, deadline - Date.now())
      const response = await fetch(`http://127.0.0.1:${port}/models`, {
        signal: AbortSignal.timeout(requestTimeout),
      })
      if (response.ok) return { ok: true }
      lastError = `health check returned HTTP ${response.status}`
    } catch (error) {
      lastError = String(error)
    }
    const retryDelay = Math.min(
      SERVICE_HEALTH_INTERVAL_MS,
      Math.max(0, deadline - Date.now()),
    )
    if (retryDelay > 0) await wait(retryDelay)
  }

  return { ok: false, error: lastError }
}

async function installSystemdService(
  target: ServiceTarget,
): Promise<ServiceInstallResult> {
  const unitPath = systemdUnitPath()
  await fs.mkdir(path.dirname(unitPath), { recursive: true })
  await fs.writeFile(unitPath, buildSystemdUnit(target))
  consola.info(`Wrote systemd unit to ${unitPath}`)

  const reload = runQuietly("systemctl", ["--user", "daemon-reload"])
  if (!reload.ok) {
    return {
      installed: false,
      manager: "systemd",
      message: `Failed to reload systemd: ${reload.output.trim()}. Unit written to ${unitPath}.`,
    }
  }

  const enable = runQuietly("systemctl", [
    "--user",
    "enable",
    `${SERVICE_NAME}.service`,
  ])
  if (!enable.ok) {
    return {
      installed: false,
      manager: "systemd",
      message: `Failed to enable service: ${enable.output.trim()}. Try: systemctl --user enable ${SERVICE_NAME}.service`,
    }
  }

  // `enable --now` does not restart an already-running service after its unit
  // changes. Restart explicitly so repeated setup runs apply the new command.
  const restart = runQuietly("systemctl", [
    "--user",
    "restart",
    `${SERVICE_NAME}.service`,
  ])
  if (!restart.ok) {
    return {
      installed: false,
      manager: "systemd",
      message: `Failed to restart service: ${restart.output.trim()}. Try: systemctl --user restart ${SERVICE_NAME}.service`,
    }
  }

  const health = await waitForService(target.port)
  if (!health.ok) {
    return {
      installed: false,
      manager: "systemd",
      message: `Service was installed but did not become ready on port ${target.port}: ${health.error}. Check: journalctl --user -u ${SERVICE_NAME} -n 100`,
    }
  }

  // Best-effort: let the user service keep running after logout / start on boot.
  const linger = runQuietly("loginctl", [
    "enable-linger",
    os.userInfo().username,
  ])
  if (!linger.ok) {
    consola.warn(
      `Could not enable lingering (service may stop on logout). Run manually: sudo loginctl enable-linger ${os.userInfo().username}`,
    )
  }

  return {
    installed: true,
    manager: "systemd",
    message: `Service installed or updated and running. Manage with: systemctl --user status ${SERVICE_NAME}`,
  }
}

// --- Scheduled Task (Windows) ---

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const currentWindowsUser = (): string => {
  const domain = process.env.USERDOMAIN
  const username = process.env.USERNAME ?? os.userInfo().username
  return domain ? `${domain}\\${username}` : username
}

const windowsLauncherPath = (): string =>
  path.join(PATHS.APP_DIR, `${SERVICE_NAME}-launch.vbs`)

const wscriptPath = (): string =>
  path.join(
    process.env.SystemRoot ?? String.raw`C:\Windows`,
    "System32",
    "wscript.exe",
  )

// VBScript launcher that starts the proxy with a hidden window (window style
// `0`), so the scheduled task does not pop up a console window.
export function buildVbsLauncher(target: ServiceTarget): string {
  const command = [
    quote(target.runtimePath),
    quote(target.scriptPath),
    ...startCommandArgs(target),
  ].join(" ")
  // In VBScript string literals, double quotes are escaped by doubling them.
  const vbsCommand = command.replaceAll('"', '""')

  return [
    `Set WshShell = CreateObject("WScript.Shell")`,
    `WshShell.Run "${vbsCommand}", 0, True`,
    `Set WshShell = Nothing`,
    ``,
  ].join("\r\n")
}

export interface WindowsTaskExec {
  command: string
  arguments: string
  userId?: string
}

export function buildWindowsTaskXml(exec: WindowsTaskExec): string {
  const command = escapeXml(exec.command)
  const args = escapeXml(exec.arguments)
  // Scoping the trigger and principal to the current user makes this a per-user
  // task that registers without administrator rights.
  const userTag =
    exec.userId ? `\n      <UserId>${escapeXml(exec.userId)}</UserId>` : ""

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>GitHub Copilot API proxy (copilot-api)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>${userTag}
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">${userTag}
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${command}</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

async function installWindowsTask(
  target: ServiceTarget,
): Promise<ServiceInstallResult> {
  // Write a persistent VBScript launcher so the task can run the proxy hidden.
  const launcherPath = windowsLauncherPath()
  await fs.mkdir(path.dirname(launcherPath), { recursive: true })
  await fs.writeFile(launcherPath, buildVbsLauncher(target))

  const xml = buildWindowsTaskXml({
    command: wscriptPath(),
    arguments: `//B //Nologo ${quote(launcherPath)}`,
    userId: currentWindowsUser(),
  })
  const xmlPath = path.join(os.tmpdir(), `${SERVICE_NAME}-task.xml`)
  // schtasks expects the XML file to be UTF-16.
  await fs.writeFile(xmlPath, `\uFEFF${xml}`, "utf16le")

  // Stop the existing tracked process before replacing the task. Failure is
  // expected on the first install or when the task is already stopped.
  runQuietly("schtasks", ["/End", "/TN", WINDOWS_TASK_NAME])

  const create = runQuietly("schtasks", [
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/XML",
    xmlPath,
    "/F",
  ])
  if (!create.ok) {
    return {
      installed: false,
      manager: "schtasks",
      message:
        `Could not register the scheduled task: ${create.output.trim()}\n`
        + `The task XML was saved to ${xmlPath}. You can import it from an `
        + `elevated terminal with:\n`
        + `  schtasks /Create /TN ${WINDOWS_TASK_NAME} /XML "${xmlPath}" /F\n`
        + `Or just start the proxy manually when needed: copilot-api start --port ${target.port} --account-type ${target.accountType}`,
    }
  }

  const start = runQuietly("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME])
  if (!start.ok) {
    return {
      installed: false,
      manager: "schtasks",
      message: `Scheduled task was registered but could not be started: ${start.output.trim()}. Try: schtasks /Run /TN ${WINDOWS_TASK_NAME}`,
    }
  }

  const health = await waitForService(target.port)
  if (!health.ok) {
    return {
      installed: false,
      manager: "schtasks",
      message: `Scheduled task was registered but the proxy did not become ready on port ${target.port}: ${health.error}. Check Task Scheduler history for "${WINDOWS_TASK_NAME}".`,
    }
  }

  return {
    installed: true,
    manager: "schtasks",
    message: `Scheduled task "${WINDOWS_TASK_NAME}" installed or updated and running (hidden). Manage it in Task Scheduler.`,
  }
}

export async function installService(
  target: ServiceTarget,
): Promise<ServiceInstallResult> {
  const platform = os.platform()

  if (platform === "linux") return installSystemdService(target)
  if (platform === "win32") return installWindowsTask(target)

  const exec = [
    target.runtimePath,
    target.scriptPath,
    ...startCommandArgs(target),
  ].join(" ")
  return {
    installed: false,
    manager: "none",
    message: `Automatic service install is not supported on "${platform}". Run this manually (e.g. via a launch agent):\n  ${exec}`,
  }
}
