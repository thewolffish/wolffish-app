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
requires:
  - package-manager
packages:
  brew: node
  winget_id: OpenJS.NodeJS.LTS
  apt: nodejs
  dnf: nodejs
tools:
  - name: node_check
    description: Check if Node.js is installed
    parameters: {}
  - name: node_install
    description: Install Node.js via the system package manager
    parameters: {}
confirm_patterns:
  - pattern: "node_install"
    reason: Installing Node.js
---

# Node.js

## Usage

Use `node_check` to verify Node.js is installed and get the version.
If not installed, call `node_install` (requires user approval).

Once installed, use the `shell_exec` tool for `node`, `npm`, and `npx` commands.
