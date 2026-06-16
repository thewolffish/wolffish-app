---
name: node
description: Node.js runtime and npm package manager
triggers:
  - node
  - npm
  - npx
  - nvm
  - javascript
  - js
  - typescript
  - ts
  - nodejs
  - react
  - vue
  - angular
  - express
  - next
  - vite
  - webpack
  - eslint
  - prettier
  - jest
  - vitest
  - mocha
  - package.json
  - node_modules
  - yarn
  - pnpm
  - deno
  - bun
  - svelte
  - nuxt
  - remix
  - astro
  - gatsby
  - electron
  - tauri
  - nestjs
  - fastify
  - koa
  - hapi
  - socket.io
  - prisma
  - sequelize
  - mongoose
  - typeorm
  - drizzle
  - zod
  - tailwind
  - postcss
  - sass
  - less
  - storybook
  - cypress
  - playwright
  - puppeteer
  - rollup
  - esbuild
  - swc
  - babel
  - tsx
  - jsx
  - node version
  - node runtime
  - check node
  - install node
  - update node
  - npm install
  - npm run
  - npm start
  - npm test
  - npm build
requires:
  - package-manager
tools:
  - name: node_check
    description: Check if Node.js is installed
    parameters: {}
  - name: node_install
    description: Install Node.js (system package manager, or a no-root local copy if elevation is unavailable)
    parameters: {}
confirm_patterns:
  - pattern: "node_install"
    reason: Installing Node.js
---

# Node.js

## Usage

Use `node_check` to verify Node.js is installed and get the version.
If not installed, call `node_install` (requires user approval) — and trust it.
`node_install` installs Node through the system package manager first (Homebrew
on macOS, apt/dnf on Linux, winget on Windows), prompting once for the admin
password when needed. Only if that can't run does it fall back to an official
no-root copy under `~/.wolffish/bin`. The system path is preferred because
Homebrew/apt also make the rest of the software ecosystem available.

Do NOT install Node yourself with raw `shell_exec` `sudo apt install nodejs` (or
`pkexec`/`brew`/`winget`). Use `node_install` — it routes through the shared
password session and the approval gate. If it returns a permission or
"password prompt cancelled" error, surface it; that error is deterministic, so
don't retry the same command.

Once installed, use the `shell_exec` tool for `node`, `npm`, and `npx` commands.
