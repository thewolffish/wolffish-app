---
name: cloudflared
description: Cloudflare Tunnel CLI for exposing local services
triggers:
  - cloudflare
  - tunnel
  - cloudflared
  - expose
  - public url
  - ngrok
  - localhost tunnel
  - port forward
  - share locally
  - public access
  - reverse proxy
  - external access
  - webhook testing
  - demo
  - temporary url
  - secure tunnel
  - share my server
  - make accessible
  - share this port
  - expose port
  - expose service
  - expose api
  - public endpoint
  - shareable link
  - shareable url
  - test webhook
  - receive webhook
  - callback url
  - argo tunnel
  - zero trust
  - quick tunnel
  - trycloudflare
  - staging url
  - preview url
  - show externally
  - access from outside
  - access from phone
  - access remotely
requires:
  - package-manager
packages:
  brew: cloudflared
  winget_id: Cloudflare.cloudflared
  apt: cloudflared
  dnf: cloudflared
tools:
  - name: cloudflared_check
    description: Check if cloudflared is installed
    parameters: {}
  - name: cloudflared_install
    description: Install cloudflared via the system package manager
    parameters: {}
  - name: cloudflared_tunnel
    description: Create a quick tunnel to expose a local port
    parameters:
      port:
        type: number
        description: Local port to expose
confirm_patterns:
  - pattern: "cloudflared_install"
    reason: Installing cloudflared
  - pattern: "cloudflared_tunnel"
    reason: Exposing a local port to the internet
---

# Cloudflared

## Usage

Use `cloudflared_check` to verify cloudflared is installed. If missing,
call `cloudflared_install` (requires user approval).

Use `cloudflared_tunnel` with a local port number to create a quick tunnel.
This starts cloudflared in the background and returns a public URL like
`https://random-name.trycloudflare.com` that routes to `localhost:{port}`.

## Rules

- Always confirm with the user before exposing a local service to the internet.
- The tunnel runs in the background. Save the PID from the response to stop it later.
- Quick tunnels use random subdomains and don't require a Cloudflare account.
