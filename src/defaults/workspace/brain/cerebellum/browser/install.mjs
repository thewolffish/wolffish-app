// Best-effort Chromium download for the browser capability.
//
// `playwright-core install chromium` validates the host OS before downloading
// and HARD-FAILS (exit 1) on any platform/distro it doesn't recognize — e.g.
// a brand-new Ubuntu release ("Playwright does not support chromium on
// ubuntu26.04-x64"). When that ran directly as the postinstall script it took
// the entire `npm install` down with it, which left the whole browser
// capability uninstalled and broke `browser_launch`.
//
// We never want a browser-binary hiccup to disable the capability: the launch
// path (plugin/index.mjs) falls back to a system-installed Chrome / Edge /
// Chromium when Playwright's bundled build is missing. So here we ATTEMPT the
// download on every platform and ALWAYS exit 0 — success gives us the bundled
// browser (the seamless path on Windows/macOS/standard Linux), failure simply
// defers to the system browser at launch time.
//
// Pure Node + cross-platform: we invoke Playwright's own CLI via the current
// Node binary (process.execPath) so there is no shell-quoting or .bin/.cmd
// resolution to get wrong on Windows.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

// Honour the standard Playwright opt-out so CI / offline installs stay fast.
if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  process.exit(0)
}

let cli
try {
  // package.json is always resolvable even when a package restricts its
  // "exports"; cli.js sits next to it in every playwright-core release.
  const pkgPath = require.resolve('playwright-core/package.json')
  cli = path.join(path.dirname(pkgPath), 'cli.js')
} catch {
  // playwright-core itself didn't install — nothing we can do here, and the
  // launch path will report a clear error. Don't fail the install.
  process.exit(0)
}

if (!cli || !existsSync(cli)) {
  process.exit(0)
}

const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit'
})

if (result.status !== 0) {
  console.warn(
    "[browser] Playwright couldn't download Chromium on this OS — " +
      'browser_launch will use a system-installed Chrome / Edge / Chromium instead.'
  )
}

// Always succeed so `npm install` for the capability completes.
process.exit(0)
