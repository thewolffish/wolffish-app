/**
 * `wolffish config` — every setting the desktop panels show, read and written
 * through the same handlers those panels call.
 *
 * Reading matters as much as writing. A config command that only sets values
 * makes you guess what the current state is, so the default listing prints the
 * card's own label, its description, and what it is set to right now — the
 * same three things the panel shows, in the user's locale.
 */
import { c, heading, icon, out, pad, question, table, visibleLength, wrapText } from '../lib/ui.mjs'

const GROUP_TITLES = {
  wolffish: 'Wolffish · runtime behavior',
  model: 'Model',
  appearance: 'Appearance',
  channels: 'Channels',
  services: 'Services',
  knowledge: 'Knowledge',
  updates: 'Updates'
}

async function locale(client) {
  try {
    const value = await client.invoke('locale:get')
    return typeof value === 'string' ? value : (value?.locale ?? 'en')
  } catch {
    return 'en'
  }
}

export async function listSettings(client, { group, json, long } = {}) {
  const cards = await client.invoke('cli:describeSettings', await locale(client))
  const filtered = group ? cards.filter((card) => card.group === group) : cards

  if (json) {
    out(JSON.stringify(filtered, null, 2))
    return 0
  }
  if (filtered.length === 0) {
    out(c.yellow(`no settings in group "${group}"`))
    return 1
  }

  let currentGroup = null
  for (const card of filtered) {
    if (card.group !== currentGroup) {
      currentGroup = card.group
      heading(GROUP_TITLES[currentGroup] ?? currentGroup)
    }
    const value =
      card.kind === 'boolean'
        ? card.value === true
          ? c.green(card.display)
          : c.gray(card.display)
        : c.cyan(card.display)
    // A setting whose registration disagrees with its stored intent gets both
    // states and a warning marker — the honest rendering of "you asked for
    // this and the machine did not do it".
    const mismatch =
      card.actual && card.value === true && !/^(active|مُفعّل|مفعل)$/i.test(card.actual)
    const actual = card.actual ? c.gray(` · ${card.actual}`) : ''
    out()
    out(
      `  ${mismatch ? icon.warn() : ' '} ${c.bold(card.label)}` +
        `${' '.repeat(Math.max(1, 44 - visibleLength(card.label)))}${value}${actual}`
    )
    out(`    ${c.gray(card.id)}`)
    if (long && card.description) out(wrapText(c.gray(card.description), 4))
    if (long && card.options?.length) {
      out(`    ${c.gray('options: ' + card.options.map((o) => o.value).join(', '))}`)
    }
  }
  out()
  if (!long) out(c.gray('  --long for descriptions and allowed values'))
  return 0
}

export async function getSetting(client, id, { json } = {}) {
  const cards = await client.invoke('cli:describeSettings', await locale(client))
  const card = cards.find((entry) => entry.id === id)
  if (!card) {
    out(c.red(`unknown setting: ${id}`))
    suggest(cards, id)
    return 1
  }
  if (json) {
    out(JSON.stringify(card, null, 2))
    return 0
  }
  heading(card.label)
  if (card.description) out(wrapText(c.gray(card.description), 2))
  out()
  const rows = [
    ['id', card.id],
    ['value', card.display]
  ]
  if (card.actual) rows.push(['registered', card.actual])
  if (card.options?.length) rows.push(['options', card.options.map((o) => o.value).join(', ')])
  const keyWidth = Math.max(...rows.map(([k]) => k.length))
  for (const [key, value] of rows) out(`  ${c.gray(pad(key, keyWidth))}  ${value}`)
  out()
  return 0
}

export async function setSetting(client, id, value) {
  const result = await client.invoke('cli:setSetting', { id, value })
  if (!result?.ok) {
    out(`${icon.fail()} ${c.red(result?.error ?? 'failed')}`)
    if (String(result?.error ?? '').startsWith('unknown setting')) {
      const cards = await client.invoke('cli:describeSettings', await locale(client))
      suggest(cards, id)
    }
    return 1
  }
  // Read back rather than echoing the input: the handler may normalize, and a
  // setting whose OS registration failed must not report success.
  const cards = await client.invoke('cli:describeSettings', await locale(client))
  const card = cards.find((entry) => entry.id === id)
  out(`${icon.ok()} ${c.bold(card?.label ?? id)} ${c.gray('→')} ${c.cyan(card?.display ?? value)}`)
  if (card?.actual) out(c.gray(`  registered: ${card.actual}`))
  return 0
}

function suggest(cards, id) {
  const needle = String(id).toLowerCase()
  const close = cards
    .map((card) => card.id)
    .filter((candidate) => candidate.toLowerCase().includes(needle.split('.').pop() ?? needle))
    .slice(0, 6)
  if (close.length > 0) {
    out(c.gray('  did you mean:'))
    for (const candidate of close) out(`    ${candidate}`)
  } else {
    out(c.gray('  list them all with: wolffish config'))
  }
}

/**
 * `wolffish keys` — API keys and channel tokens, entered without echo and
 * never as an argv token. A key typed as `wolffish config set … sk-live-…`
 * lands in the shell history file; this path does not.
 */
export async function manageKeys(client, args) {
  const [sub, ...rest] = args
  if (!sub || sub === 'list') {
    const snapshot = await client.invoke('cli:describeSettings', await locale(client))
    const providers = await client.invoke('provider:list').catch(() => [])
    heading('Model providers')
    // provider:list carries the raw key (the renderer needs it to show a
    // masked field). Only ever report whether one is present — a key printed
    // to a terminal ends up in scrollback, tmux buffers and screen shares.
    table(
      ['provider', 'model', 'key'],
      providers.map((p) => [
        p.id,
        p.model || c.gray('—'),
        p.apiKey ? c.green('set') : c.gray('not set')
      ])
    )
    const secrets = snapshot.filter((card) => card.kind === 'secret')
    if (secrets.length > 0) {
      heading('Service keys')
      table(
        ['setting', 'value'],
        secrets.map((card) => [card.id, card.value ? c.green('set') : c.gray('not set')])
      )
    }
    out()
    out(c.gray('  wolffish keys set <provider> [model]    prompts for the key, no echo'))
    return 0
  }

  if (sub === 'set') {
    const [provider, model] = rest
    if (!provider) {
      out(c.red('usage: wolffish keys set <provider> [model]'))
      return 2
    }
    const apiKey = await question(`  ${c.bold(provider)} API key ${c.dim('(hidden)')}: `, {
      hidden: true
    })
    if (!apiKey.trim()) {
      out(c.yellow('  nothing entered — unchanged'))
      return 1
    }
    const existing = (await client.invoke('provider:list').catch(() => [])).find(
      (entry) => entry.id === provider
    )
    const result = await client.invoke('provider:save', {
      id: provider,
      model: model ?? existing?.model ?? '',
      apiKey: apiKey.trim()
    })
    if (result?.ok === false) {
      out(`${icon.fail()} ${c.red(result.error ?? 'failed')}`)
      return 1
    }
    out(`${icon.ok()} saved key for ${c.bold(provider)}`)
    return 0
  }

  out(c.red(`unknown: wolffish keys ${sub}`))
  return 2
}

/** `wolffish brain` — which model runs, and switching it. */
export async function brain(client, args) {
  const providers = await client.invoke('provider:list').catch(() => [])
  if (args.length === 0) {
    heading('Brain')
    const connected = providers.filter((p) => Boolean(p.apiKey))
    if (connected.length === 0) {
      out(c.yellow('  no provider has a key yet — wolffish keys set <provider>'))
      return 1
    }
    // Which one is actually the Brain lives in the config snapshot, not in
    // provider:list — the setting is a single choice across providers.
    const snapshot = await client.invoke('cli:snapshot').catch(() => ({}))
    const activeProvider = snapshot?.llm?.brainProvider ?? null
    const activeModel = snapshot?.llm?.brainModel ?? null
    table(
      ['provider', 'model', 'active'],
      connected.map((p) => [
        p.id,
        p.model || c.gray('—'),
        activeProvider === p.id && activeModel === p.model ? c.green('●') : ''
      ])
    )
    out()
    out(c.gray('  wolffish brain <provider> <model>'))
    return 0
  }
  const [providerId, model] = args
  if (!providerId || !model) {
    out(c.red('usage: wolffish brain <provider> <model>'))
    return 2
  }
  await client.invoke('provider:setBrain', { providerId, model })
  out(`${icon.ok()} brain is now ${c.bold(`${providerId}/${model}`)}`)
  return 0
}

/** `wolffish vars` — prompt variables, the one list the phone also edits. */
export async function variables(client, args) {
  const [sub, name, ...valueParts] = args
  const current = await client.invoke('variables:list').catch(() => [])
  if (!sub || sub === 'list') {
    heading('Variables')
    if (current.length === 0) {
      out(c.gray('  none'))
      return 0
    }
    table(
      ['name', 'value'],
      current.map((v) => [v.name, v.sensitive ? c.gray('•••••') : v.value])
    )
    return 0
  }
  if (sub === 'set') {
    if (!name) {
      out(c.red('usage: wolffish vars set <name> <value>'))
      return 2
    }
    const value = valueParts.join(' ')
    const next = current.filter((v) => v.name !== name)
    next.push({ name, value, sensitive: false })
    await client.invoke('variables:save', next)
    out(`${icon.ok()} ${name}`)
    return 0
  }
  if (sub === 'rm' || sub === 'remove') {
    await client.invoke(
      'variables:save',
      current.filter((v) => v.name !== name)
    )
    out(`${icon.ok()} removed ${name}`)
    return 0
  }
  out(c.red(`unknown: wolffish vars ${sub}`))
  return 2
}

/** `wolffish capabilities` — the same list and toggles the panel shows. */
export async function capabilities(client, args) {
  const [sub, name] = args
  const list = await client.invoke('cerebellum:listCapabilities').catch(() => [])
  if (!sub || sub === 'list') {
    heading('Capabilities')
    table(
      ['name', 'tools', 'state', 'description'],
      list.map((cap) => [
        cap.name,
        String(cap.toolCount ?? 0),
        cap.core ? c.gray('core') : cap.enabled ? c.green('on') : c.gray('off'),
        String(cap.description ?? '').slice(0, 60)
      ])
    )
    out()
    out(c.gray('  wolffish capabilities on|off <name>'))
    return 0
  }
  if (sub === 'on' || sub === 'off') {
    if (!name) {
      out(c.red(`usage: wolffish capabilities ${sub} <name>`))
      return 2
    }
    try {
      await client.invoke('cerebellum:toggleCapability', name, sub === 'on')
    } catch (err) {
      out(`${icon.fail()} ${c.red(err.message)}`)
      return 1
    }
    // Read back: a locked core capability accepts the call and stays on, so
    // echoing the request would report a change that did not happen.
    const after = await client.invoke('cerebellum:listCapabilities').catch(() => [])
    const entry = after.find((cap) => cap.name === name)
    if (!entry) {
      out(`${icon.fail()} ${c.red(`unknown capability: ${name}`)}`)
      return 1
    }
    if (entry.enabled !== (sub === 'on')) {
      out(
        `${icon.warn()} ${c.yellow(`${name} is ${entry.enabled ? 'on' : 'off'}`)}` +
          (entry.core ? c.gray(' — core capabilities cannot be switched off') : '')
      )
      return 1
    }
    out(`${icon.ok()} ${name} ${sub}`)
    return 0
  }
  out(c.red(`unknown: wolffish capabilities ${sub}`))
  return 2
}
