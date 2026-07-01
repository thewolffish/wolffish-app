import { Client } from '@notionhq/client'
import fs from 'node:fs/promises'
import path from 'node:path'

let workspaceRoot = null
let cachedClient = null
let cachedToken = null

const NOTION_VERSION = '2022-06-28'

// Read every labeled Notion connection from config.json. The user can link
// several Notion workspaces (each with a user-assigned label like "Personal"
// or "Wolffish"); the model picks one per call via the `connection` param.
// Tolerates the legacy single-token shape so a call right after an update —
// before migrateConnections() rewrites config.json — still resolves.
async function readConnections() {
  if (!workspaceRoot) return []
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'config.json'), 'utf8')
    const cfg = JSON.parse(raw)
    const notion = cfg?.notion
    if (Array.isArray(notion?.connections)) {
      return notion.connections
        .map((c) => ({
          label: String(c?.label ?? '').trim() || 'Default',
          token: String(c?.token ?? '').trim(),
          name: String(c?.name ?? ''),
          email: String(c?.email ?? '')
        }))
        .filter((c) => c.token)
    }
    // Legacy single-token shape.
    const token = String(notion?.token ?? '').trim()
    if (token) {
      return [
        {
          label: String(notion?.label ?? '').trim() || 'Default',
          token,
          name: String(notion?.name ?? ''),
          email: String(notion?.email ?? '')
        }
      ]
    }
    return []
  } catch {
    return []
  }
}

// Resolve which connection a tool call should use. Returns { connection } or
// { error } (a ready-to-return tool failure). Rules: 0 connections → not
// configured; explicit `connection` label → exact (case-insensitive) match or
// an error listing the available labels; no label with exactly one connection
// → use it; no label with several → force the model to disambiguate.
function resolveConnection(connections, args) {
  if (connections.length === 0) {
    return {
      error: {
        success: false,
        error:
          'Notion is not configured. Go to Settings → Services → Notion and add a connection (a label plus an integration token).'
      }
    }
  }
  const wanted = String(args?.connection ?? '').trim()
  if (wanted) {
    const matches = connections.filter((c) => c.label.toLowerCase() === wanted.toLowerCase())
    if (matches.length === 0) {
      const labels = connections.map((c) => `"${c.label}"`).join(', ')
      return {
        error: {
          success: false,
          error: `No Notion connection labeled "${wanted}". Available connections: ${labels}. Pass one of these labels as \`connection\`.`
        }
      }
    }
    if (matches.length > 1) {
      // Never silently pick one of two same-labeled connections for a write.
      return {
        error: {
          success: false,
          error: `More than one Notion connection is labeled "${wanted}". Labels must be unique — rename them in Settings → Services → Notion so this one can be selected unambiguously.`
        }
      }
    }
    return { connection: matches[0] }
  }
  if (connections.length === 1) return { connection: connections[0] }
  const labels = connections.map((c) => `"${c.label}"`).join(', ')
  return {
    error: {
      success: false,
      error: `Multiple Notion connections are configured: ${labels}. Specify which one to use by passing its label as the \`connection\` parameter.`
    }
  }
}

// Build (or reuse) a Notion client for the connection selected by `args`.
// Returns { client } or { error }. The client is cached per token so repeated
// calls to the same connection don't rebuild it.
async function getClientFor(args) {
  const connections = await readConnections()
  const resolved = resolveConnection(connections, args)
  if (resolved.error) return { error: resolved.error }
  const token = resolved.connection.token
  if (cachedClient && cachedToken === token) return { client: cachedClient }
  cachedClient = new Client({ auth: token, notionVersion: NOTION_VERSION })
  cachedToken = token
  return { client: cachedClient }
}

function normalizeId(id) {
  if (!id || typeof id !== 'string') return id
  return id.replace(/-/g, '')
}

function ok(data) {
  return { success: true, output: JSON.stringify(data) }
}

function fail(err) {
  const message = err?.body?.message ?? err?.message ?? String(err)
  const code = err?.code ?? err?.status
  return { success: false, error: code ? `Notion API error (${code}): ${message}` : message }
}

// --- Tool implementations ---

async function executeSearch(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  try {
    const params = { query: args?.query ?? '' }
    if (args?.filter === 'page' || args?.filter === 'database') {
      params.filter = { value: args.filter, property: 'object' }
    }
    if (args?.page_size) params.page_size = Math.min(Number(args.page_size) || 10, 100)
    if (args?.sort_direction) {
      params.sort = { direction: args.sort_direction, timestamp: 'last_edited_time' }
    }
    const response = await client.search(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeReadPage(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const pageId = normalizeId(args?.page_id)
  if (!pageId) return { success: false, error: 'page_id is required' }

  try {
    const response = await client.pages.retrieve({ page_id: pageId })
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeReadBlocks(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const blockId = normalizeId(args?.block_id)
  if (!blockId) return { success: false, error: 'block_id is required' }

  try {
    const params = { block_id: blockId }
    if (args?.page_size) params.page_size = Math.min(Number(args.page_size) || 100, 100)
    if (args?.start_cursor) params.start_cursor = args.start_cursor
    const response = await client.blocks.children.list(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeCreatePage(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  if (!args?.parent) return { success: false, error: 'parent is required' }
  if (!args?.properties) return { success: false, error: 'properties is required' }

  try {
    const params = {
      parent: args.parent,
      properties: args.properties
    }
    if (args?.children) params.children = args.children
    if (args?.icon) params.icon = args.icon
    if (args?.cover) params.cover = args.cover
    const response = await client.pages.create(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeUpdatePage(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const pageId = normalizeId(args?.page_id)
  if (!pageId) return { success: false, error: 'page_id is required' }

  try {
    const params = { page_id: pageId }
    if (args?.properties) params.properties = args.properties
    if (args?.icon) params.icon = args.icon
    if (args?.cover) params.cover = args.cover
    if (typeof args?.archived === 'boolean') params.archived = args.archived
    const response = await client.pages.update(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeAppendBlocks(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const blockId = normalizeId(args?.block_id)
  if (!blockId) return { success: false, error: 'block_id is required' }
  if (!args?.children || !Array.isArray(args.children)) {
    return { success: false, error: 'children array is required' }
  }

  try {
    const response = await client.blocks.children.append({
      block_id: blockId,
      children: args.children
    })
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeReadDatabase(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const databaseId = normalizeId(args?.database_id)
  if (!databaseId) return { success: false, error: 'database_id is required' }

  try {
    const params = { database_id: databaseId }
    if (args?.filter) params.filter = args.filter
    if (args?.sorts) params.sorts = args.sorts
    if (args?.page_size) params.page_size = Math.min(Number(args.page_size) || 100, 100)
    if (args?.start_cursor) params.start_cursor = args.start_cursor
    const response = await client.databases.query(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeUpdateBlock(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const blockId = normalizeId(args?.block_id)
  if (!blockId) return { success: false, error: 'block_id is required' }

  try {
    const params = { block_id: blockId }
    if (args?.type && args?.content) {
      params[args.type] = args.content
    }
    if (typeof args?.archived === 'boolean') params.archived = args.archived
    const response = await client.blocks.update(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeDeleteBlock(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const blockId = normalizeId(args?.block_id)
  if (!blockId) return { success: false, error: 'block_id is required' }

  try {
    const response = await client.blocks.delete({ block_id: blockId })
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeCreateDatabase(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  if (!args?.parent) return { success: false, error: 'parent is required' }
  if (!args?.title) return { success: false, error: 'title is required' }
  if (!args?.properties) return { success: false, error: 'properties is required' }

  try {
    const params = {
      parent: args.parent,
      title: args.title,
      properties: args.properties
    }
    if (args?.icon) params.icon = args.icon
    if (args?.cover) params.cover = args.cover
    const response = await client.databases.create(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeUpdateDatabase(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  const databaseId = normalizeId(args?.database_id)
  if (!databaseId) return { success: false, error: 'database_id is required' }

  try {
    const params = { database_id: databaseId }
    if (args?.title) params.title = args.title
    if (args?.description) params.description = args.description
    if (args?.properties) params.properties = args.properties
    const response = await client.databases.update(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeListUsers(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  try {
    const params = {}
    if (args?.page_size) params.page_size = Math.min(Number(args.page_size) || 100, 100)
    if (args?.start_cursor) params.start_cursor = args.start_cursor
    const response = await client.users.list(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeGetUser(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  if (!args?.user_id) return { success: false, error: 'user_id is required' }

  try {
    const response = await client.users.retrieve({ user_id: args.user_id })
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeAddComment(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  if (!args?.rich_text) return { success: false, error: 'rich_text is required' }
  if (!args?.parent && !args?.discussion_id) {
    return { success: false, error: 'Either parent or discussion_id is required' }
  }

  try {
    const params = { rich_text: args.rich_text }
    if (args?.parent) params.parent = args.parent
    if (args?.discussion_id) params.discussion_id = args.discussion_id
    const response = await client.comments.create(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeListComments(args) {
  const { client, error } = await getClientFor(args)
  if (error) return error

  if (!args?.block_id) return { success: false, error: 'block_id is required' }

  try {
    const params = { block_id: normalizeId(args.block_id) }
    if (args?.page_size) params.page_size = Math.min(Number(args.page_size) || 100, 100)
    if (args?.start_cursor) params.start_cursor = args.start_cursor
    const response = await client.comments.list(params)
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeConnections() {
  const connections = await readConnections()
  const payload = {
    connections: connections.map((c) => ({
      label: c.label,
      name: c.name || null,
      email: c.email || null
    })),
    note:
      connections.length === 0
        ? 'No Notion connections are configured. Ask the user to add one in Settings → Services → Notion (each has a label and an integration token).'
        : 'Each connection is one Notion workspace the user linked, identified by a user-assigned label (e.g. "Personal", "Wolffish"). Pass the matching label as the `connection` parameter on every notion_* tool call. You may omit it only when exactly one connection exists. Match the label to the user\'s intent — e.g. "my personal notion" → the connection labeled "Personal".'
  }
  return ok(payload)
}

// --- Tool descriptors ---

const CONNECTION_PARAM = {
  type: 'string',
  description:
    'Which linked Notion connection to use, by its user-assigned label (e.g. "Personal", "Wolffish"). Optional when only one connection is configured; required to disambiguate when several exist. Call notion_connections to list labels.'
}

const toolDefinitions = [
  {
    name: 'notion_connections',
    description:
      'List the configured Notion connections (their labels and connected account) so you know which `connection` to pass on other notion_* tools. Does not expose tokens.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'notion_search',
    description:
      'Search across all pages and databases the integration can access. Returns page/database titles, IDs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        query: { type: 'string', description: 'Search query text' },
        filter: {
          type: 'string',
          description: '"page" or "database" to limit result type. Omit for both.'
        },
        page_size: { type: 'number', description: 'Max results (default 10, max 100)' },
        sort_direction: {
          type: 'string',
          description: '"ascending" or "descending" by last_edited_time'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'notion_read_page',
    description:
      "Retrieve a page's properties (title, status, dates, relations, etc). Returns raw Notion JSON.",
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        page_id: { type: 'string', description: 'The page ID (UUID)' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'notion_read_blocks',
    description: 'Read block content (body) of a page or block. Returns array of block objects.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        block_id: { type: 'string', description: 'Page or block ID to read children of' },
        page_size: { type: 'number', description: 'Max blocks per request (default 100)' },
        start_cursor: { type: 'string', description: 'Cursor for pagination' }
      },
      required: ['block_id']
    }
  },
  {
    name: 'notion_create_page',
    description:
      'Create a new page. Specify parent (database or page), properties, and optional body blocks.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        parent: {
          type: 'object',
          description: '{ "database_id": "..." } or { "page_id": "..." }'
        },
        properties: {
          type: 'object',
          description: 'Page properties as Notion property-value objects'
        },
        children: { type: 'array', description: 'Array of block objects for the page body' },
        icon: { type: 'object', description: 'Icon object' },
        cover: { type: 'object', description: 'Cover image object' }
      },
      required: ['parent', 'properties']
    }
  },
  {
    name: 'notion_update_page',
    description: "Update a page's properties, icon, cover, or archive status.",
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        page_id: { type: 'string', description: 'The page ID to update' },
        properties: { type: 'object', description: 'Properties to update' },
        icon: { type: 'object', description: 'New icon' },
        cover: { type: 'object', description: 'New cover' },
        archived: { type: 'boolean', description: 'Set true to archive (soft-delete)' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'notion_append_blocks',
    description: 'Append new block children to a page or block.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        block_id: { type: 'string', description: 'Parent page or block ID' },
        children: { type: 'array', description: 'Array of block objects to append' }
      },
      required: ['block_id', 'children']
    }
  },
  {
    name: 'notion_read_database',
    description:
      'Query a database with optional filters and sorts. Returns array of page objects (rows).',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        database_id: { type: 'string', description: 'The database ID' },
        filter: { type: 'object', description: 'Notion filter object' },
        sorts: { type: 'array', description: 'Array of sort objects' },
        page_size: { type: 'number', description: 'Max results (default 100)' },
        start_cursor: { type: 'string', description: 'Cursor for pagination' }
      },
      required: ['database_id']
    }
  },
  {
    name: 'notion_update_block',
    description: "Update an existing block's content or archive it.",
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        block_id: { type: 'string', description: 'The block ID' },
        type: { type: 'string', description: 'Block type (e.g. "paragraph", "heading_1")' },
        content: { type: 'object', description: "The block type's content object" },
        archived: { type: 'boolean', description: 'Set true to archive (delete)' }
      },
      required: ['block_id']
    }
  },
  {
    name: 'notion_delete_block',
    description: 'Delete (archive) a block by ID.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        block_id: { type: 'string', description: 'The block ID to delete' }
      },
      required: ['block_id']
    }
  },
  {
    name: 'notion_create_database',
    description: 'Create a new database as a child of an existing page.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        parent: { type: 'object', description: '{ "page_id": "..." }' },
        title: { type: 'array', description: 'Rich text title array' },
        properties: { type: 'object', description: 'Database property schema' },
        icon: { type: 'object', description: 'Icon object' },
        cover: { type: 'object', description: 'Cover image object' }
      },
      required: ['parent', 'title', 'properties']
    }
  },
  {
    name: 'notion_update_database',
    description: "Update a database's title, description, or property schema.",
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        database_id: { type: 'string', description: 'The database ID' },
        title: { type: 'array', description: 'New rich text title' },
        description: { type: 'array', description: 'Rich text description' },
        properties: { type: 'object', description: 'Property schema updates' }
      },
      required: ['database_id']
    }
  },
  {
    name: 'notion_list_users',
    description: 'List all users in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        page_size: { type: 'number', description: 'Max results (default 100)' },
        start_cursor: { type: 'string', description: 'Cursor for pagination' }
      },
      required: []
    }
  },
  {
    name: 'notion_get_user',
    description: 'Get details about a specific user by ID.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        user_id: { type: 'string', description: 'The user ID' }
      },
      required: ['user_id']
    }
  },
  {
    name: 'notion_add_comment',
    description: 'Add a comment to a page or discussion thread.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        parent: { type: 'object', description: '{ "page_id": "..." }' },
        discussion_id: {
          type: 'string',
          description: 'Discussion thread ID (alternative to parent)'
        },
        rich_text: { type: 'array', description: 'Rich text content of the comment' }
      },
      required: ['rich_text']
    }
  },
  {
    name: 'notion_list_comments',
    description: 'List comments on a block or page.',
    parameters: {
      type: 'object',
      properties: {
        connection: CONNECTION_PARAM,
        block_id: { type: 'string', description: 'Block or page ID' },
        page_size: { type: 'number', description: 'Max results (default 100)' },
        start_cursor: { type: 'string', description: 'Cursor for pagination' }
      },
      required: ['block_id']
    }
  }
]

const TOOL_MAP = {
  notion_connections: executeConnections,
  notion_search: executeSearch,
  notion_read_page: executeReadPage,
  notion_read_blocks: executeReadBlocks,
  notion_create_page: executeCreatePage,
  notion_update_page: executeUpdatePage,
  notion_append_blocks: executeAppendBlocks,
  notion_read_database: executeReadDatabase,
  notion_update_block: executeUpdateBlock,
  notion_delete_block: executeDeleteBlock,
  notion_create_database: executeCreateDatabase,
  notion_update_database: executeUpdateDatabase,
  notion_list_users: executeListUsers,
  notion_get_user: executeGetUser,
  notion_add_comment: executeAddComment,
  notion_list_comments: executeListComments
}

function describeActionBase(toolName, args) {
  switch (toolName) {
    case 'notion_connections':
      return {
        title: 'List Notion connections',
        description: 'Listing configured connections',
        risk: 'low'
      }
    case 'notion_search':
      return {
        title: 'Notion search',
        description: `Search: ${args?.query ?? '(empty)'}`,
        risk: 'low'
      }
    case 'notion_read_page':
      return {
        title: 'Read Notion page',
        description: `Page: ${args?.page_id ?? '?'}`,
        risk: 'low'
      }
    case 'notion_read_blocks':
      return {
        title: 'Read Notion blocks',
        description: `Block: ${args?.block_id ?? '?'}`,
        risk: 'low'
      }
    case 'notion_create_page':
      return { title: 'Create Notion page', description: 'Creating a new page', risk: 'medium' }
    case 'notion_update_page':
      return {
        title: 'Update Notion page',
        description: args?.archived ? 'Archiving page' : `Updating page ${args?.page_id ?? '?'}`,
        risk: args?.archived ? 'high' : 'medium'
      }
    case 'notion_append_blocks':
      return {
        title: 'Append to Notion page',
        description: `Adding blocks to ${args?.block_id ?? '?'}`,
        risk: 'medium'
      }
    case 'notion_read_database':
      return {
        title: 'Query Notion database',
        description: `Database: ${args?.database_id ?? '?'}`,
        risk: 'low'
      }
    case 'notion_update_block':
      return {
        title: 'Update Notion block',
        description: args?.archived ? 'Deleting block' : `Updating block ${args?.block_id ?? '?'}`,
        risk: args?.archived ? 'high' : 'medium'
      }
    case 'notion_delete_block':
      return {
        title: 'Delete Notion block',
        description: `Deleting block ${args?.block_id ?? '?'}`,
        risk: 'high'
      }
    case 'notion_create_database':
      return {
        title: 'Create Notion database',
        description: 'Creating a new database',
        risk: 'medium'
      }
    case 'notion_update_database':
      return {
        title: 'Update Notion database',
        description: `Updating database ${args?.database_id ?? '?'}`,
        risk: 'medium'
      }
    case 'notion_list_users':
      return { title: 'List Notion users', description: 'Listing workspace users', risk: 'low' }
    case 'notion_get_user':
      return { title: 'Get Notion user', description: `User: ${args?.user_id ?? '?'}`, risk: 'low' }
    case 'notion_add_comment':
      return { title: 'Add Notion comment', description: 'Adding a comment', risk: 'medium' }
    case 'notion_list_comments':
      return {
        title: 'List Notion comments',
        description: `Comments on: ${args?.block_id ?? '?'}`,
        risk: 'low'
      }
    default:
      return null
  }
}

export default {
  name: 'notion',
  tools: toolDefinitions,

  async init(context) {
    workspaceRoot = context?.workspaceRoot ?? null
  },

  describeAction(toolName, args) {
    const base = describeActionBase(toolName, args)
    // Surface which connection the action targets on the approval card, so a
    // user with several linked workspaces can tell "Personal" from "Wolffish".
    if (base && args?.connection) {
      base.description = base.description
        ? `${base.description} · ${args.connection}`
        : String(args.connection)
    }
    return base
  },

  async execute(toolName, args) {
    const handler = TOOL_MAP[toolName]
    if (!handler) return { success: false, error: `notion: unknown tool ${toolName}` }
    return handler(args)
  }
}
