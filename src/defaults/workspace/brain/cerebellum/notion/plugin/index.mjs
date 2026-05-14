import { Client } from '@notionhq/client'
import fs from 'node:fs/promises'
import path from 'node:path'

let workspaceRoot = null
let cachedClient = null
let cachedToken = null

const NOTION_VERSION = '2022-06-28'

async function readToken() {
  if (!workspaceRoot) return null
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'config.json'), 'utf8')
    const cfg = JSON.parse(raw)
    const token = String(cfg?.notion?.token ?? '').trim()
    return token || null
  } catch {
    return null
  }
}

async function getClient() {
  const token = await readToken()
  if (!token) return null
  if (cachedClient && cachedToken === token) return cachedClient
  cachedClient = new Client({ auth: token, notionVersion: NOTION_VERSION })
  cachedToken = token
  return cachedClient
}

function requireClient(client) {
  if (!client) {
    return {
      success: false,
      error:
        'Notion integration token not configured. Go to Settings → Services → Notion and add your integration token.'
    }
  }
  return null
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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

  if (!args?.user_id) return { success: false, error: 'user_id is required' }

  try {
    const response = await client.users.retrieve({ user_id: args.user_id })
    return ok(response)
  } catch (e) {
    return fail(e)
  }
}

async function executeAddComment(args) {
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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
  const client = await getClient()
  const err = requireClient(client)
  if (err) return err

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

// --- Tool descriptors ---

const toolDefinitions = [
  {
    name: 'notion_search',
    description:
      'Search across all pages and databases the integration can access. Returns page/database titles, IDs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
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
        page_id: { type: 'string', description: 'The page ID (UUID)' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'notion_read_blocks',
    description:
      'Read block content (body) of a page or block. Returns array of block objects.',
    parameters: {
      type: 'object',
      properties: {
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
        parent: {
          type: 'object',
          description: '{ "database_id": "..." } or { "page_id": "..." }'
        },
        properties: { type: 'object', description: 'Page properties as Notion property-value objects' },
        children: { type: 'array', description: 'Array of block objects for the page body' },
        icon: { type: 'object', description: 'Icon object' },
        cover: { type: 'object', description: 'Cover image object' }
      },
      required: ['parent', 'properties']
    }
  },
  {
    name: 'notion_update_page',
    description:
      "Update a page's properties, icon, cover, or archive status.",
    parameters: {
      type: 'object',
      properties: {
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
        parent: { type: 'object', description: '{ "page_id": "..." }' },
        discussion_id: { type: 'string', description: 'Discussion thread ID (alternative to parent)' },
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
        block_id: { type: 'string', description: 'Block or page ID' },
        page_size: { type: 'number', description: 'Max results (default 100)' },
        start_cursor: { type: 'string', description: 'Cursor for pagination' }
      },
      required: ['block_id']
    }
  }
]

const TOOL_MAP = {
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

export default {
  name: 'notion',
  tools: toolDefinitions,

  async init(context) {
    workspaceRoot = context?.workspaceRoot ?? null
  },

  describeAction(toolName, args) {
    switch (toolName) {
      case 'notion_search':
        return { title: 'Notion search', description: `Search: ${args?.query ?? '(empty)'}`, risk: 'low' }
      case 'notion_read_page':
        return { title: 'Read Notion page', description: `Page: ${args?.page_id ?? '?'}`, risk: 'low' }
      case 'notion_read_blocks':
        return { title: 'Read Notion blocks', description: `Block: ${args?.block_id ?? '?'}`, risk: 'low' }
      case 'notion_create_page':
        return { title: 'Create Notion page', description: 'Creating a new page', risk: 'medium' }
      case 'notion_update_page':
        return {
          title: 'Update Notion page',
          description: args?.archived ? 'Archiving page' : `Updating page ${args?.page_id ?? '?'}`,
          risk: args?.archived ? 'high' : 'medium'
        }
      case 'notion_append_blocks':
        return { title: 'Append to Notion page', description: `Adding blocks to ${args?.block_id ?? '?'}`, risk: 'medium' }
      case 'notion_read_database':
        return { title: 'Query Notion database', description: `Database: ${args?.database_id ?? '?'}`, risk: 'low' }
      case 'notion_update_block':
        return {
          title: 'Update Notion block',
          description: args?.archived ? 'Deleting block' : `Updating block ${args?.block_id ?? '?'}`,
          risk: args?.archived ? 'high' : 'medium'
        }
      case 'notion_delete_block':
        return { title: 'Delete Notion block', description: `Deleting block ${args?.block_id ?? '?'}`, risk: 'high' }
      case 'notion_create_database':
        return { title: 'Create Notion database', description: 'Creating a new database', risk: 'medium' }
      case 'notion_update_database':
        return { title: 'Update Notion database', description: `Updating database ${args?.database_id ?? '?'}`, risk: 'medium' }
      case 'notion_list_users':
        return { title: 'List Notion users', description: 'Listing workspace users', risk: 'low' }
      case 'notion_get_user':
        return { title: 'Get Notion user', description: `User: ${args?.user_id ?? '?'}`, risk: 'low' }
      case 'notion_add_comment':
        return { title: 'Add Notion comment', description: 'Adding a comment', risk: 'medium' }
      case 'notion_list_comments':
        return { title: 'List Notion comments', description: `Comments on: ${args?.block_id ?? '?'}`, risk: 'low' }
      default:
        return null
    }
  },

  async execute(toolName, args) {
    const handler = TOOL_MAP[toolName]
    if (!handler) return { success: false, error: `notion: unknown tool ${toolName}` }
    return handler(args)
  }
}
