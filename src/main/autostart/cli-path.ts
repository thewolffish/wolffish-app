/**
 * Making `wolffish` a command the shell can find, on all three platforms.
 *
 * This is the single most consequential piece of the CLI: everything else is
 * unreachable if the shell can't resolve the name, and the failure looks like
 * "wolffish: command not found" rather than anything that points at a fix. So
 * the app reports the state honestly (installed / missing / shadowed by
 * something else) and offers to install it, instead of assuming the packaging
 * did it.
 *
 * The entry point is a SHIM, never the app binary itself, for two reasons:
 *
 *  - On Windows the packaged executable is GUI-subsystem. Launched from a
 *    console it detaches, so `wolffish status` would print nothing at all. The
 *    shim is a console-subsystem `.cmd` that pipes through.
 *  - Booting ~150 MB of Electron to run `wolffish ls` is absurd. The shim
 *    execs the client under `ELECTRON_RUN_AS_NODE=1`, which turns the same
 *    binary you already ship into a plain node — no second runtime to install,
 *    and no window machinery on a list command.
 *
 * On Linux the `.deb`/`.rpm` postinst already creates `/usr/bin/wolffish`
 * pointing at the app binary (electron-builder's after-install template runs
 * `update-alternatives --install`). That name is therefore already taken and
 * already right — the shim only has to sit somewhere earlier on PATH, or
 * replace it when the user has the privilege.
 */
import { wlog } from '@main/workspace/logger'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const TAG = '[cli-path]'

export type CliPathStatus = {
  /** `wolffish` resolves on PATH and points at our shim. */
  installed: boolean
  /**
   * Our shim FILE exists, whether or not the shell can find it.
   *
   * Not the same question as `installed`, and the difference is what a Remove
   * control has to gate on: a shim written into a directory that is not on
   * PATH, or one shadowed by another binary, reports `installed: false` while
   * very much still being a file this app put there. Gating removal on
   * `installed` hid the button in exactly the cases someone wants it.
   */
  present: boolean
  /** Where the shim is (or would be) written. */
  target: string
  /** What `which wolffish` actually answers, when anything does. */
  resolved: string | null
  /**
   * The shim's directory is not on PATH, so writing it changed nothing the
   * shell can see. Carries the line to add to the profile.
   */
  needsPathEntry: boolean
  /** Shell snippet that fixes `needsPathEntry`, or null. */
  profileHint: string | null
  /** Something else already owns the name — usually a stale symlink. */
  shadowedBy: string | null
  /** Populated when install failed; surfaced verbatim as an alert. */
  error: string | null
}

/**
 * Where the shim goes: `~/.wolffish/bin`, the app's own managed bin directory
 * — the same one that already holds `gog`, `ffmpeg` and the voice engines.
 *
 * It used to be `~/.local/bin` on POSIX, chosen because that is the XDG
 * convention and is usually already on PATH. Two things were wrong with that.
 * It broke the project's own hard rule — *uninstall must be `rm -rf
 * ~/.wolffish/`* — by leaving an executable behind that pointed at a deleted
 * app. And the convenience it bought was not real: `~/.local/bin` is NOT in
 * macOS's default PATH (`/etc/paths` lists only /usr/local/bin and the system
 * dirs), so two of three platforms needed a profile line anyway. Windows was
 * already writing here, so the old split was also internally inconsistent.
 *
 * Needs no privilege on any platform, and it is one directory to add to PATH
 * for every wolffish-managed binary rather than one per tool.
 */
export function shimDir(): string {
  return path.join(os.homedir(), '.wolffish', 'bin')
}

export function shimPath(): string {
  return path.join(shimDir(), process.platform === 'win32' ? 'wolffish.cmd' : 'wolffish')
}

/**
 * The pre-`~/.wolffish/bin` location. Swept on install so an upgraded machine
 * does not keep a stale shim that is EARLIER on PATH than the new one — it
 * would keep winning `command -v` and silently run the old target forever.
 * Only removed when it is recognisably ours.
 */
function legacyShimPath(): string | null {
  if (process.platform === 'win32') return null
  return path.join(os.homedir(), '.local', 'bin', 'wolffish')
}

async function removeLegacyShim(): Promise<void> {
  const legacy = legacyShimPath()
  if (!legacy || !existsSync(legacy)) return
  try {
    const body = await fs.readFile(legacy, 'utf8')
    // Never delete a file we did not write. The generated banner is the
    // signature; anything else at that path belongs to the user.
    if (!body.includes('Wolffish CLI launcher')) return
    await fs.rm(legacy, { force: true })
    wlog.info(TAG, `removed legacy shim ${legacy}`)
  } catch {
    // unreadable or already gone — nothing to clean
  }
}

/**
 * The client entry the shim runs. Packaged, it rides `extraResources`; in dev
 * it is read straight out of the source tree so `npm run dev` has a working
 * `wolffish` too.
 */
export function cliEntryPath(isDev: boolean, appPath: string, resourcesPath: string): string {
  return isDev
    ? path.join(appPath, 'src', 'cli', 'wolffish.mjs')
    : path.join(resourcesPath, 'cli', 'wolffish.mjs')
}

function posixShim(execPath: string, entry: string): string {
  return `#!/bin/sh
# Wolffish CLI launcher — generated by the app, safe to regenerate.
# ELECTRON_RUN_AS_NODE turns the shipped Electron binary into a plain node,
# so the CLI needs no separate runtime and no window ever opens.
ELECTRON_RUN_AS_NODE=1 exec "${execPath}" "${entry}" "$@"
`
}

function windowsShim(execPath: string, entry: string): string {
  // @echo off + explicit exit /b keeps the console clean and preserves the
  // client's exit code, which is what makes `wolffish ... && something` work.
  return `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" "${entry}" %*\r\nexit /b %ERRORLEVEL%\r\n`
}

/** What `wolffish` resolves to right now, if anything. */
async function whichWolffish(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('where', ['wolffish'])
      const first = stdout.split(/\r?\n/).find((l) => l.trim().length > 0)
      return first ? first.trim() : null
    }
    const { stdout } = await run('sh', ['-lc', 'command -v wolffish'])
    const line = stdout.trim()
    return line.length > 0 ? line : null
  } catch {
    return null
  }
}

/**
 * Compare two paths the way the HOST does. Windows filesystems are
 * case-insensitive and its PATH separator is `;`; Linux is case-SENSITIVE, so
 * folding case there would call `/home/Ann/bin` a match for `/home/ann/bin`
 * and report a command as findable when the shell cannot find it. macOS is
 * usually case-insensitive but can be formatted either way — comparing
 * exactly is the safe direction, since a false "not installed" only offers a
 * reinstall that is already idempotent.
 */
function samePath(a: string, b: string): boolean {
  const left = path.resolve(a)
  const right = path.resolve(b)
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase()
  return left === right
}

/**
 * True when `dir` is on a PATH — the CALLER's when it sends one, this
 * process's otherwise.
 *
 * The distinction is the whole point. This runs in the daemon, and a daemon
 * started by systemd or launchd inherits a minimal PATH that has nothing to do
 * with the user's shell. Reading its own environment therefore reported "on
 * PATH: no" on every service-managed install — a confident wrong answer that
 * sent people to reinstall a shim that was already working — and reported
 * "yes" for a desktop launch that happened to inherit a login shell. The
 * terminal knows the answer for certain, because it IS the shell; it just had
 * no way to say so.
 */
function onPath(dir: string, callerPath?: string | null): boolean {
  const sep = process.platform === 'win32' ? ';' : ':'
  const entries = (callerPath ?? process.env.PATH ?? '').split(sep).filter(Boolean)
  return entries.some((entry) => samePath(entry, dir))
}

/**
 * The one line that fixes a missing PATH entry, for the shell the user is
 * actually in. `$HOME`-relative rather than expanded: this gets pasted into a
 * profile that may be synced between machines with different usernames.
 *
 * The same directory carries `gog`, `ffmpeg` and the voice engines, so adding
 * it once covers every wolffish-managed binary — and google.ts already writes
 * this exact export when it installs gogcli, which is why the hint matches its
 * wording instead of inventing a second convention.
 */
function profileHintFor(dir: string): string {
  const home = os.homedir()
  const portable = dir.startsWith(home) ? dir.replace(home, '$HOME') : dir
  if (process.platform === 'win32') {
    return `setx PATH "%PATH%;%USERPROFILE%\\.wolffish\\bin"`
  }
  const shell = path.basename(process.env.SHELL ?? 'bash')
  if (shell === 'fish') return `fish_add_path ${dir}`
  const rc = shell === 'zsh' ? '~/.zshrc' : '~/.bashrc'
  return `echo 'export PATH="${portable}:$PATH"' >> ${rc}`
}

export async function cliPathStatus(callerPath?: string | null): Promise<CliPathStatus> {
  const target = shimPath()
  const dir = shimDir()
  const present = existsSync(target)
  const resolved = await whichWolffish()
  const dirOnPath = onPath(dir, callerPath)

  // Resolving to something that is NOT our shim is the confusing case: the
  // command "works" and does the wrong thing. On Linux that is usually the
  // package's own /usr/bin/wolffish symlink to the GUI binary, which will
  // open a window instead of a prompt.
  const resolvedElsewhere = resolved !== null && !samePath(resolved, target)

  return {
    installed: present && dirOnPath && !resolvedElsewhere,
    present,
    target,
    resolved,
    needsPathEntry: present && !dirOnPath,
    profileHint: dirOnPath ? null : profileHintFor(dir),
    shadowedBy: resolvedElsewhere ? resolved : null,
    error: null
  }
}

/**
 * Write (or rewrite) the shim. Idempotent — running it after an app update is
 * the intended way to re-point it at the new binary.
 */
export async function installCliPath(execPath: string, entry: string): Promise<CliPathStatus> {
  const target = shimPath()
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    const body =
      process.platform === 'win32' ? windowsShim(execPath, entry) : posixShim(execPath, entry)
    await fs.writeFile(target, body, 'utf8')
    if (process.platform !== 'win32') await fs.chmod(target, 0o755)
    await removeLegacyShim()
    wlog.info(TAG, `installed ${target}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    wlog.warn(TAG, `install failed: ${detail}`)
    return { ...(await cliPathStatus()), error: detail }
  }
  return cliPathStatus()
}

export async function uninstallCliPath(): Promise<CliPathStatus> {
  await fs.rm(shimPath(), { force: true }).catch(() => undefined)
  return cliPathStatus()
}
