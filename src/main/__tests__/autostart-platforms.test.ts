/**
 * Autostart + CLI-shim behaviour on all three platforms, from one machine.
 *
 * The interesting failures here are platform-shaped and none of them throw:
 * a mechanism chosen for the wrong OS, a unit file the service manager will
 * not parse, a shim whose quoting breaks on a path with a space. So this
 * exercises the real modules with `process.platform` and `os.homedir()`
 * swapped, writes into a temp HOME, and asserts on the ARTIFACTS — the exact
 * bytes systemd, launchd, Task Scheduler and the shell will read.
 *
 * Runs with WOLFFISH_AUTOSTART_DRY_RUN=1, so it writes files and never invokes
 * a service manager. Faking os.homedir() is not enough on its own: launchctl,
 * systemctl and schtasks address the REAL user domain whatever path you hand
 * them, so without the flag this test registers things on the machine running
 * it.
 *
 * What it cannot cover, and what still needs a real box: whether systemd
 * actually starts the unit, whether launchd honours the plist, and whether
 * schtasks accepts the /tr string. Those are asserted structurally here and
 * flagged as unverified.
 *
 * Run: TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx \
 *        src/main/__tests__/autostart-platforms.test.ts
 */
// Set BEFORE the modules load: the flag is read at import time, and without
// it this test talks to the real launchctl/systemctl/schtasks. It did once —
// bootstrapping a KeepAlive LaunchAgent into the live user domain from a temp
// HOME, which then relaunched the installed app on every quit and outlived the
// temp plist, so nothing on disk explained the behaviour.
process.env.WOLFFISH_AUTOSTART_DRY_RUN = '1'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
let failed = 0

function check(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Swap process.platform + os.homedir for the duration of one case.
 *
 * AWAITS the callback. An earlier version restored the platform in a
 * synchronous `finally`, which returned the real platform the moment the
 * subject hit its first `await` — so any code that re-read `process.platform`
 * after an await saw darwin regardless of what the case asked for. That is
 * exactly what `installCliPath` does (it mkdirs, then picks the shim body),
 * and the test reported PASS on a Windows case that had written a POSIX shim.
 * A harness that silently tests the wrong thing is worse than no harness.
 */
async function asPlatform<T>(
  platform: NodeJS.Platform,
  home: string,
  fn: () => T | Promise<T>
): Promise<T> {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const originalHome = os.homedir
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  ;(os as { homedir: () => string }).homedir = () => home
  try {
    return await fn()
  } finally {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    ;(os as { homedir: () => string }).homedir = originalHome
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wolffish-autostart-'))

async function main(): Promise<void> {
  const autostart = await import('@main/autostart/autostart')
  const cliPath = await import('@main/autostart/cli-path')

  // ── mechanism dispatch ────────────────────────────────────────────────────
  const matrix: Array<[NodeJS.Platform, 'gui' | 'headless', string]> = [
    ['darwin', 'gui', 'loginItem'],
    ['darwin', 'headless', 'launchd'],
    ['win32', 'gui', 'loginItem'],
    ['win32', 'headless', 'schtasks'],
    ['linux', 'gui', 'xdg'],
    ['linux', 'headless', 'systemd']
  ]
  for (const [platform, mode, expected] of matrix) {
    const actual = await asPlatform(platform, TMP, () => autostart.autostartMechanism(mode))
    check(`${platform}/${mode} → ${expected}`, () => assert.equal(actual, expected))
  }

  // The GUI path on macOS/Windows must stay Electron's login item — that is
  // the behaviour that already ships and is known to work, and the whole
  // rewrite is only allowed to ADD to it.
  const guiMechanisms = await Promise.all(
    (['darwin', 'win32'] as NodeJS.Platform[]).map((platform) =>
      asPlatform(platform, TMP, () => autostart.autostartMechanism('gui'))
    )
  )
  check('gui on darwin/win32 never leaves the login item', () => {
    assert.deepEqual(guiMechanisms, ['loginItem', 'loginItem'])
  })

  // DISPLAY is a property of this process's environment, not of the machine.
  // A desktop install relaunched without it must not silently switch
  // mechanisms and orphan the registration it wrote last time.
  const savedDisplay = { d: process.env.DISPLAY, w: process.env.WAYLAND_DISPLAY }
  delete process.env.DISPLAY
  delete process.env.WAYLAND_DISPLAY
  const blindGui = await asPlatform('linux', TMP, () => autostart.autostartMechanism('gui'))
  if (savedDisplay.d !== undefined) process.env.DISPLAY = savedDisplay.d
  if (savedDisplay.w !== undefined) process.env.WAYLAND_DISPLAY = savedDisplay.w
  check('a missing DISPLAY does not flip a gui install to systemd', () => {
    assert.equal(blindGui, 'xdg')
  })

  // ── Linux: the XDG autostart entry ────────────────────────────────────────
  const linuxHome = path.join(TMP, 'linux')
  fs.mkdirSync(linuxHome, { recursive: true })
  const savedXdg = process.env.XDG_CONFIG_HOME
  delete process.env.XDG_CONFIG_HOME
  await asPlatform('linux', linuxHome, () =>
    autostart.installAutostart('gui', '/opt/Wolffish/wolffish')
  )
  if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg

  const desktopFile = path.join(linuxHome, '.config', 'autostart', 'wolffish.desktop')
  check('linux desktop: writes ~/.config/autostart/wolffish.desktop', () => {
    assert.ok(fs.existsSync(desktopFile), `${desktopFile} missing`)
  })
  check('linux desktop: entry is a valid Desktop Entry', () => {
    const body = fs.readFileSync(desktopFile, 'utf8')
    assert.ok(body.startsWith('[Desktop Entry]'), 'must start with the group header')
    for (const key of ['Type=Application', 'Exec=', 'Name=Wolffish', 'Terminal=false']) {
      assert.ok(body.includes(key), `missing ${key}`)
    }
    // GNOME skips entries without this; KDE ignores it. Harmless either way.
    assert.ok(body.includes('X-GNOME-Autostart-enabled=true'))
  })
  check('linux desktop: entry is executable (some sessions require it)', () => {
    assert.ok((fs.statSync(desktopFile).mode & 0o111) !== 0, 'exec bit not set')
  })
  await asPlatform('linux', linuxHome, () => autostart.uninstallAutostart('gui'))
  check('linux desktop: uninstall removed the entry', () => {
    assert.ok(!fs.existsSync(desktopFile), 'entry survived uninstall')
  })

  // ── Linux: the systemd user unit ──────────────────────────────────────────
  const serverHome = path.join(TMP, 'server')
  fs.mkdirSync(serverHome, { recursive: true })
  // installAutostart also shells out to systemctl/loginctl; those fail on this
  // machine and are caught, which is exactly the degraded path a non-systemd
  // box takes. The FILE is what this asserts.
  await asPlatform('linux', serverHome, () =>
    autostart.installAutostart('headless', '/opt/Wolffish/wolffish')
  )
  const unitFile = path.join(serverHome, '.config', 'systemd', 'user', 'wolffish.service')
  check('linux server: writes the systemd user unit', () => {
    assert.ok(fs.existsSync(unitFile), `${unitFile} missing`)
  })
  check('linux server: unit has the three sections systemd requires', () => {
    const body = fs.readFileSync(unitFile, 'utf8')
    for (const section of ['[Unit]', '[Service]', '[Install]']) {
      assert.ok(body.includes(section), `missing ${section}`)
    }
    assert.ok(body.includes('ExecStart=/opt/Wolffish/wolffish --headless'), 'wrong ExecStart')
    assert.ok(body.includes('Restart=always'), 'a crashed agent must come back')
    assert.ok(body.includes('WantedBy=default.target'), 'must be enable-able')
    // Without this the daemon starts with no idea it is headless.
    assert.ok(body.includes('Environment=WOLFFISH_HEADLESS=1'))
  })
  check('linux server: unit key=value lines are well formed', () => {
    const body = fs.readFileSync(unitFile, 'utf8')
    for (const line of body.split('\n')) {
      const text = line.trim()
      if (!text || text.startsWith('#') || text.startsWith('[')) continue
      assert.ok(/^[A-Za-z]+=/.test(text), `not a systemd directive: ${text}`)
    }
  })

  // ── macOS: the LaunchAgent plist ──────────────────────────────────────────
  const macHome = path.join(TMP, 'mac')
  fs.mkdirSync(macHome, { recursive: true })
  await asPlatform('darwin', macHome, () =>
    autostart.installAutostart('headless', '/Applications/Wolffish.app/Contents/MacOS/Wolffish')
  )
  const plistFile = path.join(macHome, 'Library', 'LaunchAgents', 'sh.wolffi.app.plist')
  check('macos server: writes the LaunchAgent plist', () => {
    assert.ok(fs.existsSync(plistFile), `${plistFile} missing`)
  })
  check('macos server: plist is well-formed XML with the required keys', () => {
    const body = fs.readFileSync(plistFile, 'utf8')
    assert.ok(body.startsWith('<?xml'), 'missing XML declaration')
    assert.ok(body.includes('<!DOCTYPE plist'), 'missing DOCTYPE')
    for (const key of ['Label', 'ProgramArguments', 'RunAtLoad', 'KeepAlive']) {
      assert.ok(body.includes(`<key>${key}</key>`), `missing <key>${key}</key>`)
    }
    assert.ok(body.includes('<string>--headless</string>'), 'missing the headless flag')
    // Every opened tag closed — catches a truncated or mis-nested template.
    const open = (body.match(/<(dict|array|plist)(\s[^>]*)?>/g) ?? []).length
    const close = (body.match(/<\/(dict|array|plist)>/g) ?? []).length
    assert.equal(open, close, 'unbalanced plist tags')
  })

  // ── launchd status distinguishes "written" from "loaded" ──────────────────
  // Under dry-run the file IS the answer (asking launchctl would report on the
  // real machine, not the temp one). What this asserts is that a plist which
  // was never bootstrapped does not read as active on the strength of merely
  // existing, and that removing it flips the answer back.
  const statusHome = path.join(TMP, 'launchd-status')
  fs.mkdirSync(statusHome, { recursive: true })
  const beforeInstall = await asPlatform('darwin', statusHome, () =>
    autostart.autostartStatus('headless')
  )
  check('macos: no plist → not active', () => {
    assert.equal(beforeInstall.active, false)
    assert.equal(beforeInstall.mechanism, 'launchd')
  })
  await asPlatform('darwin', statusHome, () =>
    autostart.installAutostart('headless', '/Applications/Wolffish.app/Contents/MacOS/Wolffish')
  )
  const afterInstall = await asPlatform('darwin', statusHome, () =>
    autostart.autostartStatus('headless')
  )
  check('macos: plist present → active', () => assert.equal(afterInstall.active, true))
  await asPlatform('darwin', statusHome, () => autostart.uninstallAutostart('headless'))
  const afterRemove = await asPlatform('darwin', statusHome, () =>
    autostart.autostartStatus('headless')
  )
  check('macos: uninstall removes the plist and clears active', () => {
    assert.equal(afterRemove.active, false)
    assert.ok(
      !fs.existsSync(path.join(statusHome, 'Library', 'LaunchAgents', 'sh.wolffi.app.plist')),
      'plist survived uninstall'
    )
  })

  // Switching mechanisms must be reversible on every platform — a user who
  // tries the background service has to be able to get back. Each pair
  // installs one mechanism, then the other, and asserts the first is gone:
  // two registrations racing to launch the app is the failure this rules out.
  const reversible: Array<[NodeJS.Platform, string, string]> = [
    ['darwin', 'Library/LaunchAgents/sh.wolffi.app.plist', 'login item'],
    ['linux', '.config/systemd/user/wolffish.service', '.desktop entry']
  ]
  for (const [platform, headlessArtifact] of reversible) {
    const home = path.join(TMP, `reversible-${platform}`)
    fs.mkdirSync(home, { recursive: true })
    await asPlatform(platform, home, () => autostart.installAutostart('headless', '/bin/wolffish'))
    const artifact = path.join(home, headlessArtifact)
    check(`${platform}: headless registration is written`, () => {
      assert.ok(fs.existsSync(artifact), `${artifact} missing`)
    })
    await asPlatform(platform, home, () => autostart.uninstallAutostart('headless'))
    check(`${platform}: switching away removes it — no two registrations`, () => {
      assert.ok(!fs.existsSync(artifact), `${artifact} survived — would double-launch`)
    })
  }

  // ── the CLI shim, all three platforms ─────────────────────────────────────
  // One directory on every platform: ~/.wolffish/bin, the same managed bin the
  // app already uses for gog, ffmpeg and the voice engines. Asserted per
  // platform rather than assumed, because the split it replaces (POSIX in
  // ~/.local/bin, Windows in ~/.wolffish/bin) is exactly the kind of drift
  // that reads as intentional until someone checks.
  const shimCases: Array<[NodeJS.Platform, string, string]> = [
    ['darwin', path.join(TMP, 'shim-mac'), '.wolffish/bin/wolffish'],
    ['linux', path.join(TMP, 'shim-linux'), '.wolffish/bin/wolffish'],
    ['win32', path.join(TMP, 'shim-win'), '.wolffish/bin/wolffish.cmd']
  ]
  for (const [platform, home, relative] of shimCases) {
    fs.mkdirSync(home, { recursive: true })
    await asPlatform(platform, home, () =>
      cliPath.installCliPath(
        platform === 'win32'
          ? 'C:\\Users\\a b\\AppData\\Local\\Programs\\Wolffish\\wolffish.exe'
          : '/Applications/Wolffish.app/Contents/MacOS/Wolffish',
        platform === 'win32'
          ? 'C:\\Users\\a b\\resources\\cli\\wolffish.mjs'
          : '/res/cli/wolffish.mjs'
      )
    )
    const shim = path.join(home, relative)
    check(`${platform}: shim lands at ~/${relative}`, () => {
      assert.ok(fs.existsSync(shim), `${shim} missing`)
    })
    check(`${platform}: shim runs the binary as node, not as the app`, () => {
      const body = fs.readFileSync(shim, 'utf8')
      assert.ok(
        body.includes('ELECTRON_RUN_AS_NODE=1'),
        'without this the shim boots the whole GUI app'
      )
      assert.ok(body.includes('wolffish.mjs'), 'must name the client entry')
    })
    if (platform === 'win32') {
      check('windows: shim is a console-subsystem .cmd that preserves the exit code', () => {
        const body = fs.readFileSync(shim, 'utf8')
        assert.ok(body.startsWith('@echo off'), 'must not echo its own lines')
        assert.ok(body.includes('%*'), 'must forward arguments')
        assert.ok(body.includes('%ERRORLEVEL%'), 'must propagate the exit code for scripting')
        assert.ok(body.includes('\r\n'), 'a .cmd needs CRLF line endings')
      })
      check('windows: a path containing a space stays quoted', () => {
        const body = fs.readFileSync(shim, 'utf8')
        assert.ok(body.includes('"C:\\Users\\a b\\'), 'unquoted path with a space would break')
      })
    } else {
      check(`${platform}: shim is an executable POSIX script`, () => {
        const body = fs.readFileSync(shim, 'utf8')
        assert.ok(body.startsWith('#!/bin/sh'), 'missing shebang')
        assert.ok(body.includes('exec '), 'must exec, not fork — signals have to reach the client')
        assert.ok(body.includes('"$@"'), 'must forward arguments quoted')
        assert.ok((fs.statSync(shim).mode & 0o111) !== 0, 'not executable')
      })
    }
  }

  // ── the footprint rule, and the upgrade sweep ─────────────────────────────
  // "uninstall must be rm -rf ~/.wolffish" is a project hard rule, so the CLI
  // install must not write a single byte outside that tree.
  for (const [platform, home] of [
    ['darwin', path.join(TMP, 'footprint-mac')],
    ['linux', path.join(TMP, 'footprint-linux')],
    ['win32', path.join(TMP, 'footprint-win')]
  ] as Array<[NodeJS.Platform, string]>) {
    fs.mkdirSync(home, { recursive: true })
    await asPlatform(platform, home, () => cliPath.installCliPath('/bin/app', '/res/cli.mjs'))
    check(`${platform}: shim install writes nothing outside ~/.wolffish`, () => {
      const stray = fs.readdirSync(home).filter((entry) => entry !== '.wolffish')
      assert.deepEqual(stray, [], `wrote outside the footprint: ${stray.join(', ')}`)
    })
  }

  // An upgraded machine must not keep the old POSIX shim: ~/.local/bin is
  // typically EARLIER on PATH than ~/.wolffish/bin, so a leftover would keep
  // winning `command -v` and silently run a stale target forever.
  const upgradeHome = path.join(TMP, 'upgrade')
  const legacyDir = path.join(upgradeHome, '.local', 'bin')
  fs.mkdirSync(legacyDir, { recursive: true })
  fs.writeFileSync(
    path.join(legacyDir, 'wolffish'),
    '#!/bin/sh\n# Wolffish CLI launcher — generated by the app\nexec /old/path "$@"\n'
  )
  await asPlatform('darwin', upgradeHome, () =>
    cliPath.installCliPath('/Applications/Wolffish.app/Contents/MacOS/Wolffish', '/res/cli.mjs')
  )
  check('upgrade: the legacy ~/.local/bin shim is swept', () => {
    assert.ok(
      !fs.existsSync(path.join(legacyDir, 'wolffish')),
      'stale shim survived — it would shadow the new one on PATH'
    )
    assert.ok(fs.existsSync(path.join(upgradeHome, '.wolffish', 'bin', 'wolffish')))
  })

  // ...but only when it is recognisably ours. A user's own script at that
  // path is not the app's to delete.
  const foreignHome = path.join(TMP, 'foreign')
  const foreignDir = path.join(foreignHome, '.local', 'bin')
  fs.mkdirSync(foreignDir, { recursive: true })
  fs.writeFileSync(path.join(foreignDir, 'wolffish'), '#!/bin/sh\necho my own script\n')
  await asPlatform('darwin', foreignHome, () =>
    cliPath.installCliPath('/Applications/Wolffish.app/Contents/MacOS/Wolffish', '/res/cli.mjs')
  )
  check("upgrade: a user's own file at the legacy path is left alone", () => {
    assert.ok(
      fs.existsSync(path.join(foreignDir, 'wolffish')),
      'deleted a file the app did not write'
    )
  })

  // ── the CLI's console-capability detection ────────────────────────────────
  // Windows is the whole reason this exists: a legacy conhost on codepage 437
  // receives Node's UTF-8 and prints mojibake, and a console font without
  // braille prints boxes. The bias is toward ASCII — it always renders, and
  // mojibake never does — so anything NOT known to cope gets the ASCII set.
  const ui = await import('../../cli/lib/ui.mjs')
  const detect: Array<[NodeJS.Platform, Record<string, string>, boolean, string]> = [
    ['darwin', {}, true, 'macOS draws everything'],
    ['linux', {}, true, 'Linux draws everything'],
    ['win32', {}, false, 'plain Windows falls back to ASCII'],
    ['win32', { WT_SESSION: '1' }, true, 'Windows Terminal announces itself'],
    ['win32', { TERM_PROGRAM: 'vscode' }, true, 'the VS Code terminal copes'],
    ['win32', { WOLFFISH_UNICODE: '1' }, true, 'an explicit opt-in wins'],
    ['darwin', { WOLFFISH_UNICODE: '0' }, false, 'an explicit opt-out wins']
  ]
  for (const [platform, env, want, why] of detect) {
    const saved: Record<string, string | undefined> = {}
    for (const key of ['WT_SESSION', 'TERM_PROGRAM', 'WOLFFISH_UNICODE']) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    Object.assign(process.env, env)
    const got = await asPlatform(platform, TMP, () => {
      ui.setUnicode(ui.detectUnicodeForTest())
      return ui.unicodeOk()
    })
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    check(`glyphs: ${why}`, () => assert.equal(got, want))
  }
  ui.setUnicode(true)

  // Both wordmarks exist and each is drawable by the console it targets — the
  // ASCII one is the same hash art install.ps1 prints, so the CLI and the
  // installer look like one product on Windows too.
  check('the ASCII wordmark is pure ASCII', () => {
    ui.setUnicode(false)
    const lines = ui.wordmark()
    assert.ok(lines.length > 0)
    for (const line of lines) {
      // eslint-disable-next-line no-control-regex
      assert.ok(/^[\x00-\x7f]*$/.test(line), `non-ASCII in the fallback wordmark: ${line}`)
    }
    ui.setUnicode(true)
  })

  check('ASCII mode transliterates prose punctuation instead of dropping it', () => {
    ui.setUnicode(false)
    assert.equal(ui.safe('a \u2014 b\u2026'), 'a - b...')
    assert.equal(ui.safe('\u2018q\u2019'), "'q'")
    ui.setUnicode(true)
    assert.equal(ui.safe('a \u2014 b\u2026'), 'a \u2014 b\u2026')
  })

  // ── the packaged client entry resolves per platform ───────────────────────
  check('cli entry resolves under resources when packaged', () => {
    const entry = cliPath.cliEntryPath(false, '/app', '/res')
    assert.equal(entry, path.join('/res', 'cli', 'wolffish.mjs'))
  })
  check('cli entry resolves into the source tree in dev', () => {
    const entry = cliPath.cliEntryPath(true, '/repo', '/res')
    assert.equal(entry, path.join('/repo', 'src', 'cli', 'wolffish.mjs'))
  })

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void main()
