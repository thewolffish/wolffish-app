/**
 * The notify_phone pipeline, model side down: what the TOOL refuses or
 * repairs before anything is built (untrusted model input), what the CHANNEL
 * stamps that the model must never control (phoneId, a fresh ULID, ttl from
 * phase), and how the relay's notify_result answers the tool call.
 *
 * These pins are the security posture of the feature: the model chooses
 * words; the harness chooses identity, routing and rate. If one of these
 * assertions has to change, the design constraint changed with it.
 *
 * Standalone — no vitest/jest in this repo. Run:
 *   npx tsx --tsconfig tsconfig.node.json src/main/channels/__tests__/notify-phone.test.ts
 */
import Module from 'node:module'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// workspaceRoot() reads os.homedir() at module import — override first.
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'wolffish-notify-phone-'))
process.env.HOME = SANDBOX

// Shim `electron` so the channel's import graph loads outside an Electron process.
const loader = Module as unknown as { _load: (...a: unknown[]) => unknown }
const origLoad = loader._load
loader._load = function (this: unknown, ...args: unknown[]): unknown {
  if (args[0] === 'electron') {
    return {
      app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => os.tmpdir() },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString()
      }
    }
  }
  return origLoad.apply(this, args)
}

let passed = 0
let failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    return
  }
  failed++
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
}

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/

async function run(): Promise<void> {
  const { buildMobileCapability, mintNotificationId, TTL_BY_PHASE } =
    await import('@main/channels/mobile/tools')
  const { MobileChannel } = await import('@main/channels/mobile/channel')
  const { turnScope } = await import('@main/runtime/corpus')
  type NotifyResultFrame = import('@main/tunnel/protocol').NotifyResultFrame
  type NotifyPhoneRequest = import('@main/channels/mobile/tools').NotifyPhoneRequest

  // ---------------------------------------------------------------- tool layer

  {
    const sent: NotifyPhoneRequest[] = []
    let nextRoute: NotifyResultFrame['route'] = 'inband'
    const { capability, plugin } = buildMobileCapability({
      notify: async (request) => {
        sent.push(request)
        return {
          v: 1,
          type: 'notify_result',
          notificationId: mintNotificationId(),
          route: nextRoute,
          ...(nextRoute === 'dropped' ? { reason: 'phone is offline' } : {})
        }
      }
    })
    ok('capability is the in-process phone channel', capability.name === 'phone')
    ok(
      'the single tool is notify_phone',
      plugin.tools.length === 1 && plugin.tools[0].name === 'notify_phone'
    )

    // Missing/empty title and body are refused before anything is sent.
    const noTitle = await plugin.execute('notify_phone', { body: 'b' })
    ok('missing title refused', !noTitle.success && sent.length === 0)
    const noBody = await plugin.execute('notify_phone', { title: 't' })
    ok('missing body refused', !noBody.success && sent.length === 0)

    // A deeplink outside the app scheme is refused, not repaired.
    const badLink = await plugin.execute('notify_phone', {
      title: 't',
      body: 'b',
      deeplink: 'https://evil.example/x'
    })
    ok(
      'foreign-scheme deeplink refused',
      !badLink.success && (badLink.error ?? '').includes('wolffish://') && sent.length === 0
    )

    // Model text is sanitized: newlines/controls stripped from the title,
    // both fields clamped to the wire limits, enums fall back to defaults.
    const messy = await plugin.execute('notify_phone', {
      title: '  line one\nline two\x07  ' + 'x'.repeat(80),
      body: 'keep\nthe\nnewlines ' + 'y'.repeat(300),
      phase: 'not-a-phase',
      urgency: 'shout',
      deeplink: 'wolffish://runs/1'
    })
    ok('sanitized send succeeds', messy.success === true && sent.length === 1)
    const frame = sent[0]
    ok('title is one line', !frame.title.includes('\n') && !frame.title.includes('\x07'))
    ok('title clamped to 60', frame.title.length <= 60)
    ok('body keeps newlines', frame.body.includes('\n'))
    ok('body clamped to 180', frame.body.length <= 180)
    ok('unknown phase defaults to info', frame.phase === 'info')
    ok('unknown urgency defaults to normal', frame.urgency === 'normal')
    ok('valid deeplink passes through', frame.deeplink === 'wolffish://runs/1')
    ok('runId stamped from harness scope, not the model', frame.runId === 'untracked')

    // Rate limits inside one run: 1 per phase, 5 per run, loud errors.
    await turnScope.run({ turnId: 'turn_rate_1', conversationId: null, autonomous: false }, () =>
      (async () => {
        const first = await plugin.execute('notify_phone', {
          title: 't',
          body: 'b',
          phase: 'completed'
        })
        ok('first completed notification allowed', first.success === true)
        const dupPhase = await plugin.execute('notify_phone', {
          title: 't2',
          body: 'b2',
          phase: 'completed'
        })
        ok(
          'second completed notification refused with the limit named',
          !dupPhase.success && (dupPhase.error ?? '').includes('per phase')
        )
        for (const phase of ['started', 'needs_input', 'failed', 'info']) {
          const one = await plugin.execute('notify_phone', { title: 't', body: 'b', phase })
          ok(`phase ${phase} allowed once`, one.success === true)
        }
        const sixth = await plugin.execute('notify_phone', {
          title: 't',
          body: 'b',
          phase: 'completed'
        })
        ok(
          'hard cap of 5 per run refused with the limit named',
          !sixth.success && (sixth.error ?? '').includes('5 notifications')
        )
      })()
    )

    // A different run starts with a fresh budget.
    await turnScope.run({ turnId: 'turn_rate_2', conversationId: null, autonomous: false }, () =>
      (async () => {
        const fresh = await plugin.execute('notify_phone', {
          title: 't',
          body: 'b',
          phase: 'completed'
        })
        ok('a new run has its own budget', fresh.success === true)
      })()
    )

    // A dropped notification reports failure and does NOT consume budget.
    await turnScope.run({ turnId: 'turn_rate_3', conversationId: null, autonomous: false }, () =>
      (async () => {
        nextRoute = 'dropped'
        const dropped = await plugin.execute('notify_phone', {
          title: 't',
          body: 'b',
          phase: 'completed'
        })
        ok(
          'dropped result surfaces as a tool failure with the reason',
          !dropped.success && (dropped.error ?? '').includes('phone is offline')
        )
        nextRoute = 'push'
        const retryAfterDrop = await plugin.execute('notify_phone', {
          title: 't',
          body: 'b',
          phase: 'completed'
        })
        ok('a dropped attempt did not consume the phase budget', retryAfterDrop.success === true)
        ok(
          'push route is reported to the model',
          (retryAfterDrop.output ?? '').includes('push notification')
        )
      })()
    )
  }

  // -------------------------------------------- deeplinks are model-led only

  {
    const sent: NotifyPhoneRequest[] = []
    const { plugin } = buildMobileCapability({
      notify: async (request) => {
        sent.push(request)
        return {
          v: 1,
          type: 'notify_result',
          notificationId: mintNotificationId(),
          route: 'push'
        }
      }
    })

    // 100% model-led: even inside a turn with a conversation, an omitted
    // deeplink stays null — a tap just opens the app. The harness never
    // invents a destination the model didn't name.
    await turnScope.run(
      { turnId: 'turn_dl_1', conversationId: 'conv-2026-08-05_10-00-00', autonomous: false },
      () => plugin.execute('notify_phone', { title: 't', body: 'b', phase: 'completed' })
    )
    ok('omitted deeplink stays null — no auto destination', sent[0]?.deeplink === null)

    // A deeplink the model names explicitly passes through untouched.
    await turnScope.run(
      { turnId: 'turn_dl_2', conversationId: 'conv-2026-08-05_10-00-00', autonomous: false },
      () =>
        plugin.execute('notify_phone', {
          title: 't',
          body: 'b',
          phase: 'completed',
          deeplink: 'wolffish://chat?id=conv-2026-08-05_10-00-00'
        })
    )
    ok(
      'explicit conversation deeplink passes through',
      sent[1]?.deeplink === 'wolffish://chat?id=conv-2026-08-05_10-00-00'
    )
  }

  // ------------------------------------------------------------ channel layer

  {
    const registered: string[] = []
    const unregistered: string[] = []
    const channel = new MobileChannel({
      agent: {
        cerebellum: {
          registerInProcessCapability: (cap: { name: string }) => registered.push(cap.name),
          unregisterInProcessCapability: (name: string) => unregistered.push(name)
        }
      } as never,
      runner: { send: () => ({ turnId: 't', controller: new AbortController() }) } as never,
      serializeCapabilities: async () => [],
      loadNotificationsEnabled: async () => true
    } as never)
    await channel.start()
    // Presence of the tool IS the availability signal: nothing is paired in
    // this sandbox, so the capability must NOT be registered.
    ok('no pairing → notify_phone not exposed', !registered.includes('phone'))

    type ChannelInternals = {
      pairing: Record<string, unknown> | null
      tunnel: { sendControl: (frame: Record<string, unknown>) => void } | null
      onNotifyResult: (raw: Record<string, unknown>) => void
      syncPhoneCapability: () => void
    }
    const internals = channel as unknown as ChannelInternals

    const request: NotifyPhoneRequest = {
      title: 'Run finished',
      body: 'All done.',
      phase: 'needs_input',
      urgency: 'high',
      deeplink: null,
      runId: 'turn_abc'
    }

    // No pairing at all → a clear refusal (defense in depth below the gate).
    const unpaired = await channel.notifyPhone(request).catch((error: Error) => error)
    ok('unpaired refusal', unpaired instanceof Error && unpaired.message.includes('no phone'))

    // Paired, but the phone predates deviceId → still hidden, still refused.
    internals.pairing = {
      secret: 'AAAA',
      peerPublicKey: 'ab'.repeat(32),
      method: 'qr',
      pairedAt: Date.now(),
      lastSeenAt: null,
      deviceName: 'Test phone'
    }
    internals.syncPhoneCapability()
    ok('paired without phoneId → still not exposed', !registered.includes('phone'))
    const noId = await channel.notifyPhone(request).catch((error: Error) => error)
    ok('missing phoneId refusal', noId instanceof Error && noId.message.includes('identified'))

    // The phone identifies itself (hello carries deviceId) → the tool appears.
    internals.pairing.phoneId = 'phone-device-123456'
    internals.syncPhoneCapability()
    ok('phoneId learned → notify_phone exposed', registered.includes('phone'))

    const wire: Record<string, unknown>[] = []
    internals.tunnel = {
      sendControl: (frame) => {
        wire.push(frame)
        // The relay answers immediately; simulate its result arriving back.
        setTimeout(
          () =>
            internals.onNotifyResult({
              v: 1,
              type: 'notify_result',
              notificationId: frame.notificationId,
              route: 'inband'
            }),
          0
        )
      }
    }
    const result = await channel.notifyPhone(request)
    ok('result resolves with the relay route', result.route === 'inband')
    const sentFrame = wire[0]
    ok('frame is a v1 notify', sentFrame.v === 1 && sentFrame.type === 'notify')
    ok('notificationId is a ULID', ULID_SHAPE.test(String(sentFrame.notificationId)))
    ok('phoneId comes from the pairing record', sentFrame.phoneId === 'phone-device-123456')
    ok('ttl derived from phase (needs_input=300)', sentFrame.ttl === TTL_BY_PHASE.needs_input)
    ok('runId travels with the frame', sentFrame.runId === 'turn_abc')
    ok('result id matches the frame id', result.notificationId === sentFrame.notificationId)

    // The user switch both withdraws the tool and kills the direct path.
    await channel.setNotificationsEnabled(false)
    ok('toggle off → notify_phone withdrawn', unregistered.includes('phone'))
    const off = await channel.notifyPhone(request).catch((error: Error) => error)
    ok(
      'disabled setting refuses before sending',
      off instanceof Error && off.message.includes('disabled') && wire.length === 1
    )

    // Toggling back on restores the tool without a restart.
    const before = registered.length
    await channel.setNotificationsEnabled(true)
    ok('toggle on → notify_phone re-exposed', registered.length === before + 1)
  }

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void run()
