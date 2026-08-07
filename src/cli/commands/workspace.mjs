/**
 * Everything the app's non-chat screens do: conversations, projects,
 * automations, procedures, and the three hand-written documents that shape the
 * agent (Soul, User, Agents).
 *
 * All of it rides the app's own IPC handlers — the same calls the pages make —
 * so there is no second implementation of a create, an update or a delete.
 * The CLI's contribution is the verbs and the editor handoff.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { c, heading, icon, out, relativeTime, table, wrapText } from '../lib/ui.mjs'
import { renderStoredMessage } from '../lib/render.mjs'

// ─── Conversations ──────────────────────────────────────────────────────────

export async function listConversations(client, { json, limit = 25 } = {}) {
  const conversations = await client.invoke('conversation:list')
  const rows = conversations.slice(0, limit)
  if (json) {
    out(JSON.stringify(rows, null, 2))
    return 0
  }
  heading(`Conversations ${c.gray(`(${conversations.length})`)}`)
  if (rows.length === 0) {
    out(c.gray('  none yet'))
    return 0
  }
  table(
    ['id', 'title', 'channel', 'updated'],
    rows.map((conv) => [
      c.gray(conv.id.slice(0, 8)),
      String(conv.title ?? 'Untitled').slice(0, 48),
      conv.channel ?? 'electron',
      relativeTime(conv.updatedAt)
    ])
  )
  out()
  out(c.gray('  wolffish show <id>     print a transcript'))
  out(c.gray('  wolffish resume <id>   continue it'))
  return 0
}

/** Accept an 8-char prefix the listing prints, not just a full id. */
export async function resolveConversationId(client, partial) {
  if (!partial) return null
  const conversations = await client.invoke('conversation:list')
  const exact = conversations.find((conv) => conv.id === partial)
  if (exact) return exact.id
  const matches = conversations.filter((conv) => conv.id.startsWith(partial))
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    out(c.yellow(`  "${partial}" matches ${matches.length} conversations — use more characters`))
    return null
  }
  return null
}

export async function showConversation(client, id, { verbose = false, json = false } = {}) {
  const resolved = await resolveConversationId(client, id)
  if (!resolved) {
    out(c.red(`no conversation matching "${id}"`))
    return 1
  }
  const conversation = await client.invoke('conversation:load', resolved)
  if (!conversation) {
    out(c.red('conversation not found'))
    return 1
  }
  if (json) {
    out(JSON.stringify(conversation, null, 2))
    return 0
  }
  heading(conversation.title ?? 'Untitled')
  out(c.gray(`  ${conversation.id} · ${conversation.messages.length} messages`))
  for (const message of conversation.messages) renderStoredMessage(message, { verbose })
  return 0
}

export async function deleteConversation(client, id) {
  const resolved = await resolveConversationId(client, id)
  if (!resolved) {
    out(c.red(`no conversation matching "${id}"`))
    return 1
  }
  await client.invoke('conversation:delete', resolved)
  out(`${icon.ok()} deleted ${c.gray(resolved.slice(0, 8))}`)
  return 0
}

// ─── Projects ───────────────────────────────────────────────────────────────

export async function projects(client, args) {
  const [sub, ...rest] = args
  if (!sub || sub === 'list') {
    const list = await client.invoke('projects:list')
    heading(`Projects ${c.gray(`(${list.length})`)}`)
    if (list.length === 0) {
      out(c.gray('  none — wolffish project new "<title>"'))
      return 0
    }
    table(
      ['id', 'title', 'files', 'edited'],
      list.map((p) => [
        c.gray(String(p.id).slice(0, 8)),
        `${p.icon ? p.icon + ' ' : ''}${p.title}`,
        String(p.files?.length ?? 0),
        relativeTime(p.editedAt ?? p.updatedAt ?? p.createdAt)
      ])
    )
    return 0
  }
  if (sub === 'new' || sub === 'create') {
    const title = rest.join(' ').trim()
    if (!title) {
      out(c.red('usage: wolffish project new "<title>"'))
      return 2
    }
    const created = await client.invoke('projects:create', { title })
    out(`${icon.ok()} ${created.title} ${c.gray(String(created.id).slice(0, 8))}`)
    return 0
  }
  if (sub === 'edit') {
    const [id] = rest
    const list = await client.invoke('projects:list')
    const project = list.find((p) => p.id === id || String(p.id).startsWith(id ?? ''))
    if (!project) {
      out(c.red(`no project matching "${id}"`))
      return 1
    }
    const edited = await editInEditor(project.instructions ?? '', `project-${project.id}.md`)
    if (edited === null) return 1
    await client.invoke('projects:update', { id: project.id, instructions: edited })
    out(`${icon.ok()} updated ${project.title}`)
    return 0
  }
  if (sub === 'rm' || sub === 'delete') {
    const [id] = rest
    const list = await client.invoke('projects:list')
    const project = list.find((p) => p.id === id || String(p.id).startsWith(id ?? ''))
    if (!project) {
      out(c.red(`no project matching "${id}"`))
      return 1
    }
    await client.invoke('projects:delete', project.id)
    out(`${icon.ok()} deleted ${project.title}`)
    return 0
  }
  out(c.red(`unknown: wolffish project ${sub}`))
  return 2
}

// ─── Procedures ─────────────────────────────────────────────────────────────

export async function procedures(client, args) {
  const [sub, ...rest] = args
  if (!sub || sub === 'list') {
    const list = await client.invoke('procedures:list')
    heading(`Procedures ${c.gray(`(${list.length})`)}`)
    if (list.length === 0) {
      out(c.gray('  none — wolffish procedure new "<title>" "<prompt>"'))
      return 0
    }
    table(
      ['id', 'title', 'mode'],
      list.map((p) => [
        c.gray(String(p.id).slice(0, 8)),
        `${p.icon ? p.icon + ' ' : ''}${p.title}`,
        p.mode ?? 'single'
      ])
    )
    out()
    out(c.gray('  wolffish procedure run <id>'))
    return 0
  }
  if (sub === 'new' || sub === 'create') {
    const [title, ...promptParts] = rest
    const prompt = promptParts.join(' ')
    if (!title || !prompt) {
      out(c.red('usage: wolffish procedure new "<title>" "<prompt>"'))
      return 2
    }
    const created = await client.invoke('procedures:create', { title, prompt })
    out(`${icon.ok()} ${created.title} ${c.gray(String(created.id).slice(0, 8))}`)
    return 0
  }
  if (sub === 'rm' || sub === 'delete') {
    const list = await client.invoke('procedures:list')
    const found = list.find((p) => p.id === rest[0] || String(p.id).startsWith(rest[0] ?? ''))
    if (!found) {
      out(c.red(`no procedure matching "${rest[0]}"`))
      return 1
    }
    await client.invoke('procedures:delete', found.id)
    out(`${icon.ok()} deleted ${found.title}`)
    return 0
  }
  out(c.red(`unknown: wolffish procedure ${sub}`))
  return 2
}

// ─── Automations ────────────────────────────────────────────────────────────

/**
 * Automations live in one markdown file the scheduler parses, so editing is
 * read-whole / write-whole — exactly what the desktop's cards editor does
 * underneath. `$EDITOR` is the natural terminal form of that.
 */
export async function automations(client, args) {
  const [sub, ...rest] = args
  if (!sub || sub === 'list') {
    const jobs = await client.invoke('heartbeat:getJobs')
    heading(`Automations ${c.gray(`(${jobs.length} active)`)}`)
    if (jobs.length === 0) {
      out(c.gray('  none — wolffish automation edit'))
      return 0
    }
    table(
      ['label', 'schedule', 'next run'],
      jobs.map((job) => [
        job.label ?? '—',
        job.cron ?? job.schedule ?? '—',
        job.nextRunMs ? new Date(job.nextRunMs).toLocaleString() : c.gray('—')
      ])
    )
    out()
    out(c.gray('  wolffish automation edit        open heartbeat.md in $EDITOR'))
    out(c.gray('  wolffish automation run <label> run one now'))
    return 0
  }
  if (sub === 'edit') {
    const markdown = await client.invoke('viewer:readFile', 'brain/brainstem/heartbeat.md')
    const edited = await editInEditor(markdown, 'heartbeat.md')
    if (edited === null) return 1
    await client.invoke('viewer:writeFile', 'brain/brainstem/heartbeat.md', edited)
    out(`${icon.ok()} saved — the scheduler reloads on the file change`)
    return 0
  }
  if (sub === 'run') {
    const label = rest.join(' ').trim()
    if (!label) {
      out(c.red('usage: wolffish automation run "<label>"'))
      return 2
    }
    const result = await client.invoke('heartbeat:runJob', label)
    if (result?.ok === false) {
      out(`${icon.fail()} ${c.red(result.error ?? 'failed to start')}`)
      return 1
    }
    out(`${icon.ok()} started ${label}`)
    return 0
  }
  out(c.red(`unknown: wolffish automation ${sub}`))
  return 2
}

// ─── The three shaping documents ────────────────────────────────────────────

/**
 * Soul, User and Agents are one markdown editor over one workspace file each —
 * the pages in the app do nothing more than that, so `$EDITOR` is a complete
 * equivalent rather than a reduced one.
 */
const DOCS = {
  soul: { path: 'brain/identity/self.md', title: 'Soul' },
  user: { path: 'brain/identity/user.md', title: 'User' },
  agents: { path: 'brain/prefrontal/AGENTS.md', title: 'Agents' }
}

export async function editDoc(client, name) {
  const doc = DOCS[name]
  if (!doc) {
    out(c.red(`unknown document: ${name}`))
    out(c.gray(`  one of: ${Object.keys(DOCS).join(', ')}`))
    return 2
  }
  const current = await client.invoke('viewer:readFile', doc.path).catch(() => '')
  const edited = await editInEditor(current, path.basename(doc.path))
  if (edited === null) return 1
  if (edited === current) {
    out(c.gray('  unchanged'))
    return 0
  }
  await client.invoke('viewer:writeFile', doc.path, edited)
  out(`${icon.ok()} saved ${doc.title} ${c.gray(doc.path)}`)
  return 0
}

/** `wolffish files` — the workspace tree the app's viewer shows. */
export async function browseFiles(client, prefix) {
  const tree = await client.invoke('viewer:readTree')
  heading('Workspace')
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      const indent = '  '.repeat(depth + 1)
      if (node.kind === 'directory' || node.children) {
        out(`${indent}${c.blue(node.name)}/`)
        if (depth < 1 || prefix) walk(node.children ?? [], depth + 1)
      } else {
        if (prefix && !String(node.path ?? node.name).includes(prefix)) continue
        out(`${indent}${node.name}`)
      }
    }
  }
  walk(tree, 0)
  out()
  out(c.gray('  wolffish edit <path>   open a workspace file in $EDITOR'))
  return 0
}

export async function editWorkspaceFile(client, relativePath) {
  const current = await client.invoke('viewer:readFile', relativePath).catch(() => null)
  if (current === null) {
    out(c.red(`cannot read ${relativePath}`))
    return 1
  }
  const edited = await editInEditor(current, path.basename(relativePath))
  if (edited === null) return 1
  if (edited === current) {
    out(c.gray('  unchanged'))
    return 0
  }
  await client.invoke('viewer:writeFile', relativePath, edited)
  out(`${icon.ok()} saved ${relativePath}`)
  return 0
}

/**
 * Hand content to `$EDITOR` and read back what came out. Returns null when
 * there is no editor or the user bailed — callers treat that as "changed
 * nothing", never as "save an empty file".
 */
export async function editInEditor(content, fileName) {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) {
    out(c.red('no $EDITOR set'))
    out(c.gray('  export EDITOR=nano   (or vim, micro, code --wait, …)'))
    return null
  }
  const scratch = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'wolffish-')),
    fileName || 'edit.md'
  )
  await fs.writeFile(scratch, content ?? '', 'utf8')
  const [bin, ...editorArgs] = editor.split(/\s+/)
  const code = await new Promise((resolve) => {
    const child = spawn(bin, [...editorArgs, scratch], { stdio: 'inherit' })
    child.on('close', resolve)
    child.on('error', () => resolve(1))
  })
  if (code !== 0) {
    out(c.yellow('  editor exited non-zero — nothing saved'))
    await fs.rm(path.dirname(scratch), { recursive: true, force: true }).catch(() => undefined)
    return null
  }
  const edited = await fs.readFile(scratch, 'utf8')
  await fs.rm(path.dirname(scratch), { recursive: true, force: true }).catch(() => undefined)
  return edited
}

/** `wolffish usage` — the same totals the Usage panel renders. */
export async function usage(client, range = 'month', { json } = {}) {
  const summary = await client.invoke('usage:getSummary', range)
  if (json) {
    out(JSON.stringify(summary, null, 2))
    return 0
  }
  heading(`Usage ${c.gray(range)}`)
  const providers = summary?.providers ?? summary?.byProvider ?? []
  if (Array.isArray(providers) && providers.length > 0) {
    table(
      ['provider', 'in', 'out', 'cost'],
      providers.map((p) => [
        p.provider ?? p.id,
        String(p.inputTokens ?? 0),
        String(p.outputTokens ?? 0),
        p.cost != null ? `$${Number(p.cost).toFixed(4)}` : '—'
      ])
    )
  } else {
    out(wrapText(c.gray(JSON.stringify(summary)), 2))
  }
  return 0
}
