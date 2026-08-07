/**
 * `wolffish pair` — phone, WhatsApp, Telegram.
 *
 * The QR is drawn in the terminal with half-block characters, so no image and
 * no browser is needed. That matters most on the machine that has neither: a
 * VPS reached over SSH, which is exactly where the phone becomes the way to
 * SEE anything the agent produces.
 *
 * The phone has a second route that needs no QR at all — `offerCode` exists in
 * the app for "a headless box, or a session over SSH" — so a terminal too
 * narrow for the code's 33 modules falls back to it rather than printing a
 * mangled square.
 */
import { c, err, heading, icon, out, question, width, wrapText } from '../lib/ui.mjs'

/**
 * A QR as text. Two rows of modules per line via the upper-half-block, which
 * halves the height and makes a v4+ code fit an 80×24 terminal.
 */
function renderQr(matrix) {
  const size = matrix.length
  const quiet = 2
  const lines = []
  for (let y = -quiet; y < size + quiet; y += 2) {
    let line = ''
    for (let x = -quiet; x < size + quiet; x++) {
      const top = matrix[y]?.[x] ? 1 : 0
      const bottom = matrix[y + 1]?.[x] ? 1 : 0
      // Dark modules must render dark on BOTH terminal themes, so the blocks
      // are drawn as foreground glyphs on the default background rather than
      // with colour — inverted on a light theme a coloured QR won't scan.
      if (top && bottom) line += '█'
      else if (top) line += '▀'
      else if (bottom) line += '▄'
      else line += ' '
    }
    lines.push('  ' + line)
  }
  return lines.join('\n')
}

/**
 * The app already depends on `qrcode` for the panels; the CLI runs under the
 * app's own runtime, so it is importable here too. If it somehow isn't, every
 * caller has a text fallback — never a dead end.
 */
async function toMatrix(text) {
  try {
    const { default: QRCode } = await import('qrcode')
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
    const size = qr.modules.size
    const data = qr.modules.data
    const matrix = []
    for (let y = 0; y < size; y++) {
      const row = []
      for (let x = 0; x < size; x++) row.push(Boolean(data[y * size + x]))
      matrix.push(row)
    }
    return matrix
  } catch {
    return null
  }
}

async function printQr(text, { fallbackLabel = 'link' } = {}) {
  const matrix = await toMatrix(text)
  if (!matrix) {
    out(c.gray(`  (no QR renderer available — ${fallbackLabel} below)`))
    out(`  ${text}`)
    return false
  }
  if (matrix.length + 4 > width()) {
    out(c.yellow('  terminal too narrow for the QR — widen it, or use the code instead'))
    return false
  }
  out()
  out(renderQr(matrix))
  return true
}

export async function pair(client, args) {
  const [target, ...rest] = args
  if (!target) {
    heading('Pairing')
    out('  wolffish pair phone [--code]   pair the mobile app')
    out('  wolffish pair whatsapp          link a WhatsApp account')
    out('  wolffish pair telegram          set the bot token')
    out()
    return 2
  }
  if (target === 'phone') return pairPhone(client, rest)
  if (target === 'whatsapp') return pairWhatsApp(client)
  if (target === 'telegram') return pairTelegram(client)
  out(c.red(`unknown pairing target: ${target}`))
  return 2
}

async function pairPhone(client, rest) {
  const preferCode = rest.includes('--code')
  heading('Pair your phone')

  const status = preferCode
    ? await client.invoke('mobile:offerCode')
    : await client.invoke('mobile:offerQr')

  const offer = status?.offer
  if (!offer) {
    out(c.red('  the desktop did not produce a pairing offer'))
    return 1
  }

  if (offer.code) {
    out()
    out(`  ${c.bold(c.cyan(offer.code))}`)
    out()
    out(wrapText(c.gray('Enter this code in the Wolffish app on your phone.'), 2))
  } else if (offer.payload) {
    const drew = await printQr(offer.payload, { fallbackLabel: 'pairing payload' })
    out()
    out(wrapText(c.gray('Scan this with the Wolffish app on your phone.'), 2))
    if (!drew) {
      out(wrapText(c.gray('Or run: wolffish pair phone --code'), 2))
    }
  }

  if (offer.expiresAt) {
    const seconds = Math.max(0, Math.round((offer.expiresAt - Date.now()) / 1000))
    out(c.gray(`  expires in ${seconds}s`))
  }

  // Watch for the handshake so the terminal says "paired" instead of leaving
  // the user guessing whether the scan worked.
  out()
  out(c.gray('  waiting… (Ctrl-C to stop)'))
  return new Promise((resolve) => {
    const off = client.onEvent((channel, payload) => {
      if (channel !== 'mobile:statusChange') return
      if (payload?.paired || payload?.state === 'connected') {
        off()
        out(`${icon.ok()} ${c.green('phone paired')}`)
        resolve(0)
      }
    })
    process.once('SIGINT', () => {
      off()
      out()
      resolve(1)
    })
  })
}

async function pairWhatsApp(client) {
  heading('Link WhatsApp')
  await client.invoke('whatsapp:setConfig', { enabled: true }).catch(() => undefined)
  await client.invoke('whatsapp:requestQr').catch(() => undefined)

  let drawn = 0
  return new Promise((resolve) => {
    const off = client.onEvent(async (channel, payload) => {
      if (channel !== 'whatsapp:statusChange') return
      if (payload?.status === 'connected') {
        off()
        out(`${icon.ok()} ${c.green('WhatsApp linked')}`)
        resolve(0)
        return
      }
      // WhatsApp Web rotates its QR every ~20s. Redraw on each one and say so
      // — a scrollback full of stale squares is worse than one live square.
      if (payload?.qr && payload.qr !== drawn) {
        drawn = payload.qr
        out()
        out(c.gray(`  code refreshed — scan the newest one`))
        await printQr(payload.qr, { fallbackLabel: 'whatsapp code' })
        out(wrapText(c.gray('WhatsApp → Settings → Linked devices → Link a device'), 2))
      }
    })
    out(c.gray('  waiting for a code… (Ctrl-C to stop)'))
    process.once('SIGINT', () => {
      off()
      out()
      resolve(1)
    })
  })
}

async function pairTelegram(client) {
  heading('Telegram bot')
  out(wrapText(c.gray('Create a bot with @BotFather and paste its token below.'), 2))
  out()
  const token = await question(`  ${c.bold('bot token')} ${c.dim('(hidden)')}: `, { hidden: true })
  if (!token.trim()) {
    out(c.yellow('  nothing entered — unchanged'))
    return 1
  }
  const result = await client.invoke('telegram:setConfig', {
    botToken: token.trim(),
    enabled: true
  })
  if (result?.ok === false) {
    err(`${icon.fail()} ${c.red(result.error ?? 'failed')}`)
    return 1
  }
  out(`${icon.ok()} token saved — starting the bot`)
  return 0
}
