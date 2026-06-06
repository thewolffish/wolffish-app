export {}

/**
 * Tool filtering tests — 30 scenarios at limit=100 with REAL tool names.
 * Each test asserts that specific critical tools are present in the kept list.
 * Output shows the full prompt and the exact tools selected.
 *
 * Run: npx tsx src/main/runtime/__tests__/tool-filter-100.test.ts
 */

// ---------------------------------------------------------------------------
// RAS mirror (ras.ts)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'can',
  'may',
  'might',
  'this',
  'that',
  'it',
  'i',
  'you',
  'we',
  'they',
  'my',
  'your',
  'our',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'from'
])

function tokenize(message: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const tokens = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  for (const t of tokens) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function scoreRelevance(message: string, content: string): number {
  const keywords = tokenize(message)
  if (keywords.length === 0) return 0
  const haystack = content.toLowerCase()
  let hits = 0
  for (const kw of keywords) {
    if (haystack.includes(kw)) hits++
  }
  return hits / keywords.length
}

// ---------------------------------------------------------------------------
// Real capability definitions (mirrors SKILL.md files exactly)
// ---------------------------------------------------------------------------

type Tool = { name: string; description: string }
type Cap = { name: string; description: string; keywords: string[]; tools: Tool[] }

const CAPABILITIES: Cap[] = [
  {
    name: 'filesystem',
    description: 'Read, write, and edit files on the local system',
    keywords: [
      'file',
      'files',
      'read',
      'write',
      'edit',
      'create',
      'save',
      'open',
      'patch',
      'modify',
      'content',
      'folder',
      'directory',
      'rename',
      'move',
      'copy',
      'delete',
      'remove',
      'path',
      'text',
      'overwrite',
      'append',
      'list files',
      'show file',
      'update file',
      'change file',
      "what's in",
      'replace',
      'find and replace',
      'look at',
      'check file',
      'config',
      'configuration',
      'log',
      'document',
      'txt',
      'json',
      'yaml',
      'yml',
      'xml',
      'env',
      'dotfile',
      'gitignore',
      'readme',
      'makefile'
    ],
    tools: [
      {
        name: 'file_read',
        description: "Read a file's text contents, optionally restricted to a line range"
      },
      {
        name: 'file_write',
        description: 'Create or overwrite a text file. Use mode=append to append instead'
      },
      {
        name: 'file_patch',
        description: 'Find a literal string in a file and replace every occurrence'
      }
    ]
  },
  {
    name: 'shell',
    description: 'Execute shell commands on the local system',
    keywords: [
      'run',
      'execute',
      'command',
      'terminal',
      'shell',
      'bash',
      'npm',
      'npx',
      'git',
      'pip',
      'docker',
      'brew',
      'curl',
      'wget',
      'zsh',
      'powershell',
      'cmd',
      'script',
      'process',
      'grep',
      'find',
      'ls',
      'mkdir',
      'chmod',
      'sudo',
      'ssh',
      'tar',
      'zip',
      'unzip',
      'python',
      'java',
      'go',
      'cargo',
      'yarn',
      'pnpm',
      'make',
      'cmake',
      'install',
      'compile',
      'build',
      'deploy',
      'test',
      'debug',
      'output',
      'background',
      'kill',
      'dev server',
      'start server',
      'port',
      'localhost'
    ],
    tools: [{ name: 'shell_exec', description: 'Run a shell command and return its output' }]
  },
  {
    name: 'web-search',
    description: 'Search the web and read web pages for current information',
    keywords: [
      'search',
      'google',
      'look up',
      'find online',
      'web',
      'browse',
      'website',
      'url',
      'link',
      'news',
      'latest',
      'current',
      'today',
      'recent',
      'article',
      'documentation',
      'docs',
      'what is',
      'who is',
      'how to',
      'fetch',
      'page',
      'site',
      'research',
      'information',
      'learn about',
      'tell me about',
      'explain',
      'find out',
      'look into',
      'check online',
      'weather',
      'price',
      'stock',
      'score',
      'result',
      'update',
      'trending',
      'wiki',
      'wikipedia',
      'tutorial',
      'guide',
      'reference',
      'manual',
      'blog',
      'forum',
      'stackoverflow',
      'api docs'
    ],
    tools: [
      { name: 'web_search', description: 'Search the web for information' },
      { name: 'web_fetch', description: 'Fetch and read the full text content of a web page' }
    ]
  },
  {
    name: 'google',
    description:
      'Google Workspace integration — Gmail, Drive, Calendar, Contacts, Tasks, and Sheets',
    keywords: [
      'google',
      'gmail',
      'email',
      'inbox',
      'send email',
      'compose email',
      'search email',
      'mark as read',
      'mark read',
      'archive email',
      'trash email',
      'forward email',
      'save draft',
      'delete event',
      'update event',
      'reschedule',
      'complete task',
      'delete task',
      'create contact',
      'add contact',
      'create folder',
      'drive',
      'upload file',
      'download file',
      'list files',
      'google drive',
      'calendar',
      'events',
      'schedule',
      'meeting',
      'appointment',
      'create event',
      'contacts',
      'address book',
      'phone number',
      'tasks',
      'todo',
      'task list',
      'sheets',
      'spreadsheet',
      'google sheets',
      'mail',
      'message',
      'reply',
      'draft',
      'label',
      'unread',
      'starred',
      'attachment',
      'invite',
      'attendee',
      'reminder',
      'due date',
      'workspace',
      'cloud storage',
      'shared drive',
      'my drive',
      'check email',
      'new email',
      'read email',
      'write email',
      'any mail',
      'upcoming',
      'next meeting',
      'free time',
      'busy',
      'availability',
      'add task',
      "what's on my calendar",
      'what meetings'
    ],
    tools: [
      { name: 'google_accounts', description: 'List the Google accounts the user has authorized' },
      { name: 'google_gmail_search', description: 'Search Gmail messages by query' },
      { name: 'google_gmail_read', description: 'Read a full email thread by ID' },
      { name: 'google_gmail_send', description: 'Send a new email' },
      { name: 'google_gmail_labels', description: 'List all Gmail labels for the account' },
      { name: 'google_gmail_mark_read', description: 'Mark messages as read' },
      { name: 'google_gmail_archive', description: 'Archive messages from inbox' },
      { name: 'google_gmail_mark_unread', description: 'Mark messages as unread' },
      { name: 'google_gmail_trash', description: 'Move messages to trash' },
      { name: 'google_gmail_forward', description: 'Forward a message to new recipients' },
      { name: 'google_gmail_draft_create', description: 'Save a draft email without sending' },
      { name: 'google_drive_list', description: 'List files in Google Drive' },
      { name: 'google_drive_search', description: 'Search Google Drive files by name or content' },
      { name: 'google_drive_upload', description: 'Upload a local file to Google Drive' },
      { name: 'google_drive_download', description: 'Download a file from Google Drive' },
      { name: 'google_drive_delete', description: 'Move a Drive file to trash' },
      { name: 'google_drive_mkdir', description: 'Create a new folder in Google Drive' },
      { name: 'google_calendar_events', description: 'List upcoming calendar events' },
      { name: 'google_calendar_create', description: 'Create a new calendar event' },
      { name: 'google_calendar_update', description: 'Update an existing calendar event' },
      { name: 'google_calendar_delete', description: 'Delete a calendar event permanently' },
      {
        name: 'google_contacts_search',
        description: 'Search Google Contacts by name email or phone'
      },
      { name: 'google_contacts_create', description: 'Create a new Google contact' },
      { name: 'google_tasks_list', description: 'List Google Tasks and task lists' },
      { name: 'google_tasks_add', description: 'Add a new task to a task list' },
      { name: 'google_tasks_complete', description: 'Mark a task as completed' },
      { name: 'google_tasks_delete', description: 'Delete a task permanently' },
      { name: 'google_sheets_read', description: 'Read data from a Google Sheets spreadsheet' },
      { name: 'google_sheets_write', description: 'Write data to a Google Sheets spreadsheet' }
    ]
  },
  {
    name: 'github',
    description:
      'GitHub integration — repos, issues, pull requests, branches, CI/Actions, code search, releases, gists',
    keywords: [
      'github',
      'pull request',
      'PR',
      'issue',
      'repo',
      'repository',
      'branch',
      'merge',
      'CI',
      'actions',
      'workflow',
      'commit history',
      'code review',
      'release',
      'gist',
      'organization',
      'org',
      'collaborator',
      'invite',
      'comment',
      'label',
      'milestone',
      'review',
      'reviewer',
      'notification',
      'star',
      'fork',
      'compare',
      'dispatch',
      'topic',
      'clone',
      'commit',
      'push',
      'deploy',
      'pipeline',
      'build status',
      'check',
      'assignee',
      'assign',
      'tag',
      'version',
      'changelog',
      'open issue',
      'close issue',
      'create issue',
      'list issues',
      'list PRs',
      'merge PR',
      'approve',
      'request changes',
      'dependabot',
      'security',
      'vulnerability',
      'contributor',
      'readme',
      'license',
      'gitignore',
      'webhook',
      'secret',
      'environment',
      'pages',
      'discussion',
      'sponsorship'
    ],
    tools: [
      { name: 'github_list_repos', description: "List the authenticated user's repositories" },
      { name: 'github_get_repo', description: 'Get details about a specific repository' },
      { name: 'github_create_repo', description: 'Create a new repository' },
      { name: 'github_list_issues', description: 'List issues in a repository' },
      { name: 'github_get_issue', description: 'Get details about a specific issue' },
      { name: 'github_create_issue', description: 'Create a new issue in a repository' },
      { name: 'github_close_issue', description: 'Close an issue' },
      { name: 'github_list_prs', description: 'List pull requests in a repository' },
      { name: 'github_get_pr', description: 'Get details about a specific pull request' },
      { name: 'github_create_pr', description: 'Create a new pull request' },
      { name: 'github_merge_pr', description: 'Merge a pull request' },
      { name: 'github_list_branches', description: 'List branches in a repository' },
      { name: 'github_delete_branch', description: 'Delete a branch' },
      { name: 'github_get_workflow_runs', description: 'Get workflow run history' },
      { name: 'github_get_workflow_run_logs', description: 'Get logs from a workflow run' },
      { name: 'github_create_release', description: 'Create a new release' },
      { name: 'github_search_code', description: 'Search for code across repositories' },
      { name: 'github_get_file_content', description: 'Get the content of a file in a repository' },
      { name: 'github_list_gists', description: 'List gists for the authenticated user' },
      { name: 'github_create_gist', description: 'Create a new gist' },
      { name: 'github_delete_repo', description: 'Delete a repository' },
      {
        name: 'github_list_user_orgs',
        description: 'List organizations for the authenticated user'
      },
      { name: 'github_list_org_repos', description: 'List repositories in an organization' },
      { name: 'github_get_authenticated_user', description: 'Get the authenticated user profile' },
      { name: 'github_list_collaborators', description: 'List collaborators on a repository' },
      { name: 'github_add_collaborator', description: 'Add a collaborator to a repository' },
      {
        name: 'github_remove_collaborator',
        description: 'Remove a collaborator from a repository'
      },
      {
        name: 'github_list_comments_on_issue',
        description: 'List comments on an issue or pull request'
      },
      { name: 'github_add_comment', description: 'Add a comment to an issue or pull request' },
      { name: 'github_list_labels', description: 'List labels in a repository' },
      { name: 'github_create_label', description: 'Create a new label' },
      { name: 'github_add_labels_to_issue', description: 'Add labels to an issue' },
      { name: 'github_list_milestones', description: 'List milestones in a repository' },
      { name: 'github_create_milestone', description: 'Create a new milestone' },
      { name: 'github_list_pr_reviews', description: 'List reviews on a pull request' },
      { name: 'github_request_reviewers', description: 'Request reviewers for a pull request' },
      { name: 'github_list_pr_files', description: 'List files changed in a pull request' },
      { name: 'github_update_pr', description: 'Update a pull request title description or state' },
      { name: 'github_list_releases', description: 'List releases in a repository' },
      { name: 'github_get_release', description: 'Get a specific release' },
      { name: 'github_list_repo_topics', description: 'List topics on a repository' },
      { name: 'github_replace_repo_topics', description: 'Replace all topics on a repository' },
      { name: 'github_get_commit', description: 'Get a specific commit' },
      { name: 'github_compare_commits', description: 'Compare two commits' },
      {
        name: 'github_list_notifications',
        description: 'List notifications for the authenticated user'
      },
      { name: 'github_mark_notifications_read', description: 'Mark all notifications as read' },
      { name: 'github_list_stargazers', description: 'List stargazers of a repository' },
      { name: 'github_star_repo', description: 'Star a repository' },
      { name: 'github_unstar_repo', description: 'Unstar a repository' },
      { name: 'github_fork_repo', description: 'Fork a repository' },
      { name: 'github_rerun_workflow', description: 'Re-run a workflow' },
      { name: 'github_cancel_workflow_run', description: 'Cancel a workflow run' },
      { name: 'github_dispatch_workflow', description: 'Dispatch a workflow event' }
    ]
  },
  {
    name: 'browser',
    description:
      'Automate web browsers — navigate sites, fill forms, click buttons, extract data, take screenshots',
    keywords: [
      'browser',
      'web',
      'website',
      'navigate',
      'login',
      'scrape',
      'screenshot',
      'form',
      'download',
      'cookie',
      'tab',
      'click',
      'url',
      'page',
      'crawl',
      'automate',
      'headless',
      'chromium',
      'firefox',
      'webkit',
      'playwright',
      'site',
      'webpage',
      'link',
      'href',
      'submit',
      'button',
      'input',
      'dropdown',
      'select',
      'checkbox',
      'sign in',
      'sign up',
      'register',
      'fill form',
      'extract data',
      'extract text',
      'table',
      'hover',
      'scroll',
      'keyboard',
      'type',
      'credential',
      'password',
      'open website',
      'go to',
      'visit',
      'browse',
      'surf',
      'html',
      'dom',
      'element',
      'selector',
      'xpath',
      'css selector',
      'network',
      'request',
      'response',
      'pdf',
      'print page',
      'capture',
      'automation',
      'bot',
      'web scraping',
      'data extraction'
    ],
    tools: [
      { name: 'browser_launch', description: 'Launch a browser instance and return a session_id' },
      { name: 'browser_close', description: 'Close a browser session and clean up all resources' },
      { name: 'browser_navigate', description: 'Navigate to a URL in the active tab' },
      { name: 'browser_screenshot', description: 'Take a screenshot of the current page' },
      {
        name: 'browser_page_content',
        description: 'Extract text HTML or markdown content from the page'
      },
      { name: 'browser_click', description: 'Click an element on the page' },
      { name: 'browser_fill', description: 'Fill a form field' },
      { name: 'browser_select', description: 'Select an option from a dropdown' },
      { name: 'browser_type', description: 'Type text character by character' },
      { name: 'browser_keyboard', description: 'Press a keyboard key or shortcut' },
      { name: 'browser_hover', description: 'Hover over an element' },
      { name: 'browser_scroll', description: 'Scroll the page or element' },
      {
        name: 'browser_form_fill',
        description: 'Fill an entire form at once with multiple fields'
      },
      { name: 'browser_extract_table', description: 'Extract an HTML table as structured JSON' },
      { name: 'browser_extract_links', description: 'Extract all links from the page' },
      {
        name: 'browser_store_credential',
        description: 'Store login credentials securely in runtime memory'
      },
      { name: 'browser_clear_credentials', description: 'Clear stored credentials from memory' },
      { name: 'browser_list_credentials', description: 'List stored credential IDs and metadata' },
      { name: 'browser_wait', description: 'Wait for a condition on the page' },
      { name: 'browser_evaluate', description: 'Execute JavaScript in the page context' },
      {
        name: 'browser_download',
        description: 'Trigger and capture a file download from the page'
      },
      { name: 'browser_cookies', description: 'Read set or clear browser cookies' },
      { name: 'browser_network_log', description: 'Get recent network requests made by the page' },
      { name: 'browser_pdf', description: 'Save the current page as a PDF file' },
      { name: 'browser_multi_tab', description: 'Open a new tab in an existing browser session' }
    ]
  },
  {
    name: 'browser-extension',
    description: "Control the user's connected Chrome/Brave browser via the Wolffish extension",
    keywords: [
      'browser',
      'extension',
      'chrome',
      'brave',
      'web',
      'navigate',
      'click',
      'tab',
      'screenshot',
      'cookie',
      'page',
      'url',
      'form',
      'download',
      'scrape',
      'open page',
      'go to',
      'visit',
      'site',
      'website',
      'webpage',
      'link',
      'browse',
      'surf',
      'search',
      'fill',
      'submit',
      'button',
      'input',
      'type',
      'scroll',
      'reload',
      'refresh',
      'bookmark',
      'history',
      'javascript',
      'console',
      'inspect',
      'element',
      'selector',
      'dom',
      'html',
      'content',
      'extract',
      'read page',
      'capture',
      'new tab',
      'close tab',
      'switch tab'
    ],
    tools: [
      {
        name: 'ext_navigate',
        description: 'Navigate to a URL in the active tab of the connected browser'
      },
      { name: 'ext_back', description: 'Navigate back in browser history' },
      { name: 'ext_forward', description: 'Navigate forward in browser history' },
      { name: 'ext_reload', description: 'Reload the current page' },
      { name: 'ext_click', description: 'Click an element on the page' },
      { name: 'ext_type', description: 'Type text into a focused or specified element' },
      { name: 'ext_select', description: 'Select a dropdown option' },
      { name: 'ext_hover', description: 'Hover over an element' },
      { name: 'ext_scroll', description: 'Scroll the page' },
      { name: 'ext_focus', description: 'Focus an element' },
      { name: 'ext_keypress', description: 'Press a keyboard key' },
      { name: 'ext_drag_drop', description: 'Drag and drop an element' },
      { name: 'ext_file_upload', description: 'Upload a file via file input' },
      { name: 'ext_read_page', description: 'Read page content as text or HTML' },
      { name: 'ext_query_selector', description: 'Query DOM elements by selector' },
      { name: 'ext_get_attribute', description: 'Get an attribute of an element' },
      { name: 'ext_get_value', description: 'Get the value of a form element' },
      { name: 'ext_get_url', description: 'Get the current page URL' },
      { name: 'ext_get_page_info', description: 'Get page title URL and metadata' },
      { name: 'ext_tabs_list', description: 'List all open tabs' },
      { name: 'ext_tab_open', description: 'Open a new tab' },
      { name: 'ext_tab_close', description: 'Close a tab' },
      { name: 'ext_tab_switch', description: 'Switch to a tab' },
      { name: 'ext_tab_duplicate', description: 'Duplicate a tab' },
      { name: 'ext_tab_move', description: 'Move a tab' },
      { name: 'ext_windows_list', description: 'List all browser windows' },
      { name: 'ext_window_open', description: 'Open a new browser window' },
      { name: 'ext_window_close', description: 'Close a browser window' },
      { name: 'ext_window_resize', description: 'Resize a browser window' },
      { name: 'ext_screenshot', description: 'Take a screenshot of the visible page' },
      { name: 'ext_pdf', description: 'Save the page as PDF' },
      { name: 'ext_cookies_get', description: 'Get cookies for a domain' },
      { name: 'ext_cookies_set', description: 'Set a cookie' },
      { name: 'ext_cookies_remove', description: 'Remove a cookie' },
      { name: 'ext_storage_get', description: 'Get browser storage data' },
      { name: 'ext_storage_set', description: 'Set browser storage data' },
      { name: 'ext_clipboard_read', description: 'Read clipboard content' },
      { name: 'ext_clipboard_write', description: 'Write to clipboard' },
      { name: 'ext_download', description: 'Download a file' },
      { name: 'ext_execute_js', description: 'Execute JavaScript in the page' },
      { name: 'ext_wait_for', description: 'Wait for an element to appear' },
      { name: 'ext_wait_for_navigation', description: 'Wait for page navigation' },
      { name: 'ext_wait_for_network_idle', description: 'Wait for network to be idle' },
      { name: 'ext_notify', description: 'Show a browser notification' }
    ]
  },
  {
    name: 'computer-use',
    description: 'Desktop automation — take screenshots, move/click mouse, type text, press keys',
    keywords: [
      'screenshot',
      'click',
      'screen',
      'desktop',
      'browser',
      'open app',
      'navigate',
      'scroll',
      'type into',
      'mouse',
      'keyboard',
      "what's on my screen",
      'computer use',
      'automate',
      'UI',
      'display',
      'monitor',
      'window',
      'application',
      'app',
      'cursor',
      'pointer',
      'drag',
      'drop',
      'button',
      'menu',
      'toolbar',
      'icon',
      'taskbar',
      'dock',
      'finder',
      'right click',
      'double click',
      'hotkey',
      'shortcut',
      'press key',
      'enter text',
      'what do you see',
      'show me',
      'look at screen',
      'visual',
      'GUI',
      'interface'
    ],
    tools: [
      { name: 'computer_screenshot', description: 'Take a screenshot of the full screen' },
      { name: 'computer_mouse_move', description: 'Move the mouse cursor to x,y coordinates' },
      {
        name: 'computer_mouse_click',
        description: 'Click the mouse at current or specified position'
      },
      { name: 'computer_mouse_scroll', description: 'Scroll the mouse wheel' },
      { name: 'computer_keyboard_type', description: 'Type text using the keyboard' },
      { name: 'computer_keyboard_press', description: 'Press a keyboard key or shortcut' },
      { name: 'computer_list_displays', description: 'List available displays' },
      { name: 'computer_wait', description: 'Wait for a specified duration' }
    ]
  },
  {
    name: 'document',
    description:
      'Read, create, modify, convert, and merge documents (docx, html, markdown, plain text)',
    keywords: [
      'document',
      'word',
      'docx',
      'report',
      'letter',
      'memo',
      'template',
      'write document',
      'create report',
      'fill template',
      'convert document',
      'markdown to word',
      'word to pdf',
      'table of contents',
      'merge documents',
      'compare documents',
      'extract text',
      'doc',
      'rtf',
      'html',
      'txt',
      'plain text',
      'rich text',
      'formatting',
      'heading',
      'paragraph',
      'header',
      'footer',
      'page number',
      'margin',
      'font',
      'style',
      'image',
      'figure',
      'contract',
      'proposal',
      'invoice',
      'resume',
      'cv',
      'cover letter',
      'manuscript',
      'essay',
      'thesis',
      'paper',
      'article',
      'newsletter',
      'brochure',
      'flyer'
    ],
    tools: [
      { name: 'document_read', description: 'Read any document file and extract content' },
      { name: 'document_create', description: 'Create a professional docx document' },
      { name: 'document_modify', description: 'Modify an existing document' },
      { name: 'document_template', description: 'Fill a document template with data' },
      { name: 'document_convert', description: 'Convert between document formats' },
      { name: 'document_merge', description: 'Merge multiple documents into one' },
      { name: 'document_toc', description: 'Generate a table of contents' },
      { name: 'document_metadata', description: 'Read or set document metadata' },
      { name: 'document_compare', description: 'Compare two documents and show differences' },
      { name: 'document_extract_images', description: 'Extract images from a document' }
    ]
  },
  {
    name: 'spreadsheet',
    description: 'Read, create, modify, analyze, and convert spreadsheet files (xlsx, csv, tsv)',
    keywords: [
      'spreadsheet',
      'excel',
      'xlsx',
      'csv',
      'tsv',
      'table',
      'data',
      'workbook',
      'cells',
      'formula',
      'chart',
      'pivot',
      'analyze data',
      'import csv',
      'export csv',
      'columns',
      'rows',
      'filter data',
      'xls',
      'worksheet',
      'cell',
      'range',
      'sum',
      'average',
      'count',
      'sort',
      'vlookup',
      'calculate',
      'computation',
      'statistics',
      'graph',
      'plot',
      'bar chart',
      'line chart',
      'pie chart',
      'data analysis',
      'report',
      'tabular',
      'matrix',
      'grid',
      'merge cells',
      'split cells',
      'conditional formatting',
      'budget',
      'financial',
      'accounting',
      'invoice',
      'inventory',
      'metrics',
      'dashboard'
    ],
    tools: [
      {
        name: 'spreadsheet_read',
        description: 'Read any spreadsheet file and return structured JSON data'
      },
      { name: 'spreadsheet_create', description: 'Create a new spreadsheet from data' },
      { name: 'spreadsheet_modify', description: 'Modify cells in an existing spreadsheet' },
      { name: 'spreadsheet_formula', description: 'Add or evaluate formulas' },
      { name: 'spreadsheet_chart', description: 'Create a chart from spreadsheet data' },
      { name: 'spreadsheet_style', description: 'Apply styling to cells' },
      { name: 'spreadsheet_convert', description: 'Convert between spreadsheet formats' },
      { name: 'spreadsheet_analyze', description: 'Run statistical analysis on data' },
      { name: 'spreadsheet_filter', description: 'Filter and sort spreadsheet data' },
      { name: 'spreadsheet_pivot', description: 'Create a pivot table' }
    ]
  },
  {
    name: 'pdf',
    description: 'Read, create, modify, merge, split, secure, and compress PDF documents',
    keywords: [
      'pdf',
      'document',
      'merge pdf',
      'split pdf',
      'combine pdf',
      'watermark',
      'form fill',
      'extract text',
      'encrypt pdf',
      'compress pdf',
      'pdf password',
      'read pdf',
      'create pdf',
      'acrobat',
      'portable document',
      'scan',
      'ocr',
      'convert to pdf',
      'save as pdf',
      'print to pdf',
      'sign pdf',
      'annotate',
      'bookmark',
      'page',
      'rotate',
      'crop',
      'stamp',
      'redact',
      'flatten',
      'optimize',
      'reduce size',
      'invoice',
      'receipt',
      'contract',
      'certificate',
      'form',
      'fillable'
    ],
    tools: [
      { name: 'pdf_read', description: 'Extract text metadata and structure from a PDF file' },
      {
        name: 'pdf_create',
        description: 'Create a new PDF from scratch with text headings images tables'
      },
      { name: 'pdf_merge', description: 'Merge multiple PDF files into one' },
      { name: 'pdf_split', description: 'Split a PDF into multiple files' },
      { name: 'pdf_modify', description: 'Modify pages in a PDF (rotate delete reorder)' },
      { name: 'pdf_form', description: 'Fill PDF form fields' },
      { name: 'pdf_secure', description: 'Encrypt or add password protection to a PDF' },
      { name: 'pdf_extract_images', description: 'Extract images from a PDF' },
      { name: 'pdf_compress', description: 'Compress a PDF to reduce file size' }
    ]
  },
  {
    name: 'notion',
    description: 'Read, create, update, and manage Notion pages, databases, and blocks',
    keywords: [
      'notion',
      'workspace',
      'wiki',
      'knowledge base',
      'database',
      'page',
      'note',
      'document',
      'kanban',
      'board',
      'table',
      'task tracker',
      'project management',
      'block',
      'property',
      'relation',
      'rollup',
      'filter',
      'sort',
      'view',
      'gallery',
      'list',
      'timeline',
      'calendar',
      'template',
      'backlink',
      'comment',
      'mention',
      'bookmark',
      'embed',
      'toggle',
      'callout',
      'heading',
      'bullet',
      'checkbox',
      'todo',
      'sprint',
      'roadmap',
      'docs',
      'meeting notes',
      'standup',
      'content'
    ],
    tools: [
      { name: 'notion_search', description: 'Search across all pages and databases' },
      { name: 'notion_read_page', description: 'Read a Notion page' },
      { name: 'notion_read_blocks', description: 'Read blocks within a page' },
      { name: 'notion_create_page', description: 'Create a new Notion page' },
      { name: 'notion_update_page', description: 'Update a Notion page properties' },
      { name: 'notion_append_blocks', description: 'Append blocks to a page' },
      { name: 'notion_read_database', description: 'Query a Notion database' },
      { name: 'notion_update_block', description: 'Update a block' },
      { name: 'notion_delete_block', description: 'Delete a block' },
      { name: 'notion_create_database', description: 'Create a new database' },
      { name: 'notion_update_database', description: 'Update database properties' },
      { name: 'notion_list_users', description: 'List users in the workspace' },
      { name: 'notion_get_user', description: 'Get a user by ID' },
      { name: 'notion_add_comment', description: 'Add a comment to a page' },
      { name: 'notion_list_comments', description: 'List comments on a page' }
    ]
  },
  {
    name: 'memes',
    description: 'Find, generate, and share memes and GIFs',
    keywords: [
      'meme',
      'memes',
      'funny',
      'gif',
      'laugh',
      'humor',
      'joke',
      'lighten',
      'mood',
      'reaction',
      'lol',
      'lmao',
      'haha',
      'cheer up',
      'frustrated',
      'celebrate',
      'hilarious',
      'comedy',
      'rofl',
      'emoji',
      'sticker',
      'drake',
      'distracted boyfriend',
      'this is fine',
      'stonks',
      'doge',
      'pepe',
      'sarcasm',
      'irony',
      'send meme',
      'make meme',
      'create meme',
      'trending',
      'viral',
      'entertainment',
      'fun',
      'bored'
    ],
    tools: [
      { name: 'add_to_chat', description: 'Insert a meme or GIF into the chat as an inline image' },
      { name: 'meme_generate', description: 'Generate a captioned meme image using a template' },
      { name: 'meme_templates', description: 'List available meme templates' },
      { name: 'gif_search', description: 'Search for GIFs by keyword' },
      { name: 'gif_trending', description: 'Get trending GIFs' }
    ]
  },
  {
    name: 'introspect',
    description: "Check Wolffish's own status, performance, and memory",
    keywords: [
      'status',
      'health',
      'performance',
      'how are you',
      'what do you know',
      'what do you remember',
      'uptime',
      'stats',
      'memory usage',
      'how many',
      'diagnostics',
      'system info',
      'capabilities',
      'loaded',
      'active',
      'running',
      'wolffish',
      'self',
      'about',
      'version',
      'provider',
      'model',
      'configuration',
      'settings',
      'error rate',
      'success rate',
      'tool usage',
      'what can you do',
      'what tools'
    ],
    tools: [
      {
        name: 'wolffish_status',
        description: 'Get current Wolffish status including uptime active provider'
      },
      {
        name: 'wolffish_performance',
        description: 'Get performance stats including task success rates'
      },
      { name: 'wolffish_memory', description: 'Get a summary of what Wolffish remembers' }
    ]
  },
  {
    name: 'speech-to-text',
    description: 'Transcribe audio files into text using OpenAI Whisper',
    keywords: [
      'transcribe',
      'transcription',
      'speech to text',
      'stt',
      'whisper',
      'audio to text',
      'convert audio',
      'what does this say',
      "what's in this audio",
      'listen to this',
      'dictation',
      'voice to text',
      'what did they say',
      'recognize speech',
      'subtitle',
      'subtitles',
      'mp3',
      'wav',
      'm4a',
      'ogg',
      'flac',
      'aac',
      'wma',
      'recording',
      'podcast',
      'interview',
      'meeting recording',
      'voice note',
      'voice message',
      'voicemail',
      'caption',
      'transcript',
      'minutes',
      'speech recognition',
      'language detection',
      'audio file'
    ],
    tools: [
      { name: 'stt_transcribe', description: 'Transcribe an audio file at a given path' },
      { name: 'stt_transcribe_upload', description: 'Transcribe an uploaded audio file' },
      { name: 'stt_transcribe_voice_memo', description: 'Transcribe a voice memo from chat' },
      { name: 'stt_detect_language', description: 'Detect the language of an audio file' }
    ]
  },
  {
    name: 'text-to-speech',
    description: 'Generate voice memos from text using neural TTS',
    keywords: [
      'voice',
      'speak',
      'say',
      'audio',
      'read aloud',
      'voice memo',
      'tts',
      'text to speech',
      'say this',
      'read this',
      'talk',
      'narrate',
      'spoken',
      'pronounce',
      'recite',
      'announce',
      'dictate',
      'speech',
      'sound',
      'mp3',
      'audio file',
      'voice message',
      'voice note',
      'podcast',
      'audiobook',
      'read out loud',
      'tell me',
      'convert to audio',
      'generate audio',
      'generate voice',
      'synthesize'
    ],
    tools: [
      { name: 'voice_generate', description: 'Convert text to a voice memo MP3' },
      { name: 'voice_respond', description: 'Respond with a voice message instead of text' },
      { name: 'voice_list', description: 'List available TTS voices' }
    ]
  },
  {
    name: 'ffmpeg',
    description: 'FFmpeg multimedia framework for video/audio processing',
    keywords: [
      'ffmpeg',
      'video',
      'audio',
      'convert',
      'transcode',
      'compress',
      'encode',
      'decode',
      'mp4',
      'mkv',
      'avi',
      'mov',
      'webm',
      'mp3',
      'wav',
      'aac',
      'flac',
      'ogg',
      'trim',
      'cut',
      'clip',
      'merge video',
      'concat',
      'resize video',
      'scale',
      'bitrate',
      'codec',
      'h264',
      'h265',
      'hevc',
      'gif',
      'thumbnail',
      'extract audio',
      'extract frame',
      'subtitle',
      'watermark',
      'rotate',
      'crop',
      'filter',
      'resolution',
      'fps',
      'frame rate',
      'media',
      'multimedia',
      'screen recording',
      'stream'
    ],
    tools: [
      { name: 'ffmpeg_check', description: 'Check if ffmpeg is installed' },
      { name: 'ffmpeg_install', description: 'Install ffmpeg via the system package manager' },
      { name: 'ffmpeg_run', description: 'Run an ffmpeg command for video/audio processing' }
    ]
  },
  {
    name: 'cloudflared',
    description: 'Cloudflare Tunnel CLI for exposing local services',
    keywords: [
      'cloudflare',
      'tunnel',
      'cloudflared',
      'expose',
      'public url',
      'ngrok',
      'localhost tunnel',
      'port forward',
      'share locally',
      'public access',
      'reverse proxy',
      'external access',
      'webhook testing',
      'demo',
      'temporary url',
      'secure tunnel'
    ],
    tools: [
      { name: 'cloudflared_check', description: 'Check if cloudflared is installed' },
      {
        name: 'cloudflared_install',
        description: 'Install cloudflared via the system package manager'
      },
      { name: 'cloudflared_tunnel', description: 'Create a quick tunnel to expose a local port' }
    ]
  },
  {
    name: 'node',
    description: 'Node.js runtime and npm package manager',
    keywords: [
      'node',
      'npm',
      'npx',
      'nvm',
      'javascript',
      'js',
      'typescript',
      'ts',
      'nodejs',
      'react',
      'vue',
      'angular',
      'express',
      'next',
      'vite',
      'webpack',
      'eslint',
      'prettier',
      'jest',
      'vitest',
      'mocha',
      'package.json',
      'node_modules',
      'yarn',
      'pnpm',
      'deno',
      'bun'
    ],
    tools: [
      { name: 'node_check', description: 'Check if Node.js is installed' },
      { name: 'node_install', description: 'Install Node.js via the system package manager' }
    ]
  },
  {
    name: 'package-manager',
    description: 'Cross-platform system package manager',
    keywords: [
      'install',
      'package',
      'brew',
      'winget',
      'apt',
      'dependency',
      'homebrew',
      'dnf',
      'yum',
      'pacman',
      'snap',
      'flatpak',
      'choco',
      'chocolatey',
      'uninstall',
      'upgrade',
      'update',
      'software',
      'tool',
      'binary',
      'setup',
      'prerequisite',
      'requirement'
    ],
    tools: [
      { name: 'pkg_check', description: 'Check if a system package manager is available' },
      { name: 'pkg_install_manager', description: 'Install the system package manager if missing' },
      { name: 'pkg_install', description: 'Install a package using the system package manager' }
    ]
  }
]

// ---------------------------------------------------------------------------
// Filter algorithm mirror (from agent.ts)
// ---------------------------------------------------------------------------

type ToolDef = { name: string; description: string; parameters: Record<string, unknown> }

function buildContent(cap: Cap): string {
  return [
    cap.name,
    cap.description,
    ...cap.keywords,
    ...cap.tools.map((t) => t.name + ' ' + t.description)
  ].join(' ')
}

function filterToolsForLimit(
  allTools: ToolDef[],
  message: string,
  limit: number,
  capabilities: Cap[]
): { kept: ToolDef[]; dropped: string[] } {
  if (allTools.length <= limit) return { kept: allTools, dropped: [] }

  const toolToCap = new Map<string, string>()
  for (const cap of capabilities) {
    for (const t of cap.tools) toolToCap.set(t.name, cap.name)
  }

  const capToolMap = new Map<string, ToolDef[]>()
  const orphaned: ToolDef[] = []
  for (const tool of allTools) {
    const capName = toolToCap.get(tool.name)
    if (!capName) {
      orphaned.push(tool)
      continue
    }
    const list = capToolMap.get(capName) ?? []
    list.push(tool)
    capToolMap.set(capName, list)
  }

  const capMap = new Map(capabilities.map((c) => [c.name, c]))
  const scored: Array<{ name: string; score: number; tools: ToolDef[] }> = []
  for (const [capName, capTools] of capToolMap) {
    const cap = capMap.get(capName)
    const content = cap ? buildContent(cap) : capName
    scored.push({ name: capName, score: scoreRelevance(message, content), tools: capTools })
  }
  scored.sort((a, b) => b.score - a.score || a.tools.length - b.tools.length)

  const kept: ToolDef[] = [...orphaned]
  const dropped: string[] = []
  let remaining = limit - orphaned.length

  for (const entry of scored) {
    if (remaining <= 0) {
      dropped.push(entry.name)
      continue
    }
    if (entry.tools.length <= remaining) {
      kept.push(...entry.tools)
      remaining -= entry.tools.length
    } else {
      const toolScored = entry.tools
        .map((t) => ({ tool: t, score: scoreRelevance(message, t.name + ' ' + t.description) }))
        .sort((a, b) => b.score - a.score)
      const partial = toolScored.slice(0, remaining)
      kept.push(...partial.map((p) => p.tool))
      remaining -= partial.length
      dropped.push(entry.name + '(partial)')
    }
  }
  return { kept, dropped }
}

// ---------------------------------------------------------------------------
// Test cases — 30 scenarios at limit=100, asserting on specific tool names
// ---------------------------------------------------------------------------

type TestCase = {
  prompt: string
  criticalTools: string[] // specific tool names that MUST be in the kept list
}

const TEST_CASES: TestCase[] = [
  // 1. Forward an email
  {
    prompt: 'Forward the email from John to my manager',
    criticalTools: [
      'google_accounts',
      'google_gmail_search',
      'google_gmail_read',
      'google_gmail_forward'
    ]
  },
  // 2. Draft a reply
  {
    prompt: 'Save a draft reply to the latest message from Alice',
    criticalTools: [
      'google_accounts',
      'google_gmail_search',
      'google_gmail_read',
      'google_gmail_draft_create'
    ]
  },
  // 3. Schedule a meeting
  {
    prompt: 'Schedule a meeting with the design team next Tuesday at 2pm',
    criticalTools: ['google_accounts', 'google_calendar_events', 'google_calendar_create']
  },
  // 4. Reschedule an event
  {
    prompt: 'Reschedule my dentist appointment to Friday morning',
    criticalTools: ['google_accounts', 'google_calendar_events', 'google_calendar_update']
  },
  // 5. Create a GitHub PR
  {
    prompt: 'Create a pull request from the feature/auth branch to main',
    criticalTools: ['github_create_pr', 'github_list_branches']
  },
  // 6. Review PR files
  {
    prompt: 'Show me the files changed in pull request #42 and add a review comment',
    criticalTools: ['github_get_pr', 'github_list_pr_files', 'github_add_comment']
  },
  // 7. CI/CD workflow status
  {
    prompt: 'Check the latest CI workflow run status and get the logs if it failed',
    criticalTools: ['github_get_workflow_runs', 'github_get_workflow_run_logs']
  },
  // 8. Scrape a webpage
  {
    prompt: 'Launch a browser, navigate to the product page, and extract all links',
    criticalTools: ['browser_launch', 'browser_navigate', 'browser_extract_links']
  },
  // 9. Fill a login form
  {
    prompt: 'Log into the dashboard using my stored credentials and take a screenshot',
    criticalTools: [
      'browser_launch',
      'browser_navigate',
      'browser_fill',
      'browser_click',
      'browser_screenshot'
    ]
  },
  // 10. Chrome extension: read a page
  {
    prompt: 'Use the Chrome extension to read the content of the current page',
    criticalTools: ['ext_read_page', 'ext_get_url']
  },
  // 11. Extension: manage tabs
  {
    prompt: 'List all my open Chrome tabs and close the ones from youtube.com',
    criticalTools: ['ext_tabs_list', 'ext_tab_close']
  },
  // 12. Desktop: open an app and screenshot
  {
    prompt: 'Take a screenshot of my desktop, then click on the Slack icon',
    criticalTools: ['computer_screenshot', 'computer_mouse_click']
  },
  // 13. Create a Word report
  {
    prompt: 'Create a quarterly report document in Word format with a table of contents',
    criticalTools: ['document_create', 'document_toc']
  },
  // 14. Compare two documents
  {
    prompt: 'Compare the old contract.docx and new contract_v2.docx and show differences',
    criticalTools: ['document_read', 'document_compare']
  },
  // 15. Excel pivot table
  {
    prompt: 'Open the sales_data.xlsx file and create a pivot table by region',
    criticalTools: ['spreadsheet_read', 'spreadsheet_pivot']
  },
  // 16. CSV to chart
  {
    prompt: 'Import the metrics.csv data and generate a bar chart of monthly revenue',
    criticalTools: ['spreadsheet_read', 'spreadsheet_chart']
  },
  // 17. Merge PDFs with password
  {
    prompt: 'Merge chapter1.pdf and chapter2.pdf into one file and encrypt it with a password',
    criticalTools: ['pdf_merge', 'pdf_secure']
  },
  // 18. Read and fill a PDF form
  {
    prompt: 'Read the tax_form.pdf and fill in the name and address fields',
    criticalTools: ['pdf_read', 'pdf_form']
  },
  // 19. Notion database query
  {
    prompt: 'Search my Notion workspace for the project tracker database and list all open tasks',
    criticalTools: ['notion_search', 'notion_read_database']
  },
  // 20. Notion page + comments
  {
    prompt: 'Create a new meeting notes page in Notion and add a comment tagging Sarah',
    criticalTools: ['notion_create_page', 'notion_add_comment']
  },
  // 21. Transcribe + file read
  {
    prompt: 'Transcribe the interview recording at ~/recordings/interview.m4a to text',
    criticalTools: ['stt_transcribe']
  },
  // 22. Voice memo from text
  {
    prompt: 'Generate a voice memo reading the summary aloud and list available voices',
    criticalTools: ['voice_generate', 'voice_list']
  },
  // 23. Video trim with ffmpeg
  {
    prompt: 'Trim the first 30 seconds from the video.mp4 file using ffmpeg',
    criticalTools: ['ffmpeg_run']
  },
  // 24. Cloudflare tunnel
  {
    prompt: 'Expose my local dev server running on port 8080 via a Cloudflare tunnel',
    criticalTools: ['cloudflared_tunnel']
  },
  // 25. Search + fetch a doc page
  {
    prompt: 'Search online for the Django REST framework documentation and read the auth section',
    criticalTools: ['web_search', 'web_fetch']
  },
  // 26. File + shell: build a project
  {
    prompt: 'Read the Makefile, then run make build in the terminal',
    criticalTools: ['file_read', 'shell_exec']
  },
  // 27. Google Sheets read + write
  {
    prompt: 'Read the budget spreadsheet from Google Sheets and update cell B5 with the new total',
    criticalTools: ['google_accounts', 'google_sheets_read', 'google_sheets_write']
  },
  // 28. GitHub release + tag
  {
    prompt: 'Create a new v2.1.0 release on GitHub with the changelog',
    criticalTools: ['github_create_release']
  },
  // 29. Multi: email + drive + calendar
  {
    prompt:
      'Check my inbox for any emails with attachments, download them to Drive, and check my calendar for today',
    criticalTools: [
      'google_accounts',
      'google_gmail_search',
      'google_drive_upload',
      'google_calendar_events'
    ]
  },
  // 30. Multi: browser scrape + spreadsheet + PDF
  {
    prompt:
      'Scrape the pricing table from the competitor website, save it as an Excel spreadsheet, and export a PDF report',
    criticalTools: [
      'browser_launch',
      'browser_navigate',
      'browser_extract_table',
      'spreadsheet_create',
      'pdf_create'
    ]
  }
]

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const LIMIT = 100

function run(): void {
  const allTools: ToolDef[] = []
  for (const cap of CAPABILITIES) {
    for (const t of cap.tools) {
      allTools.push({ name: t.name, description: t.description, parameters: {} })
    }
  }

  console.log(`\n  Total tools: ${allTools.length}`)
  console.log(`  Limit: ${LIMIT}`)
  console.log(`  Scenarios: ${TEST_CASES.length}\n`)
  console.log('─'.repeat(90))

  let passed = 0
  let failed = 0

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]
    const { kept, dropped } = filterToolsForLimit(allTools, tc.prompt, LIMIT, CAPABILITIES)
    const keptNames = new Set(kept.map((t) => t.name))

    const missing: string[] = []
    for (const need of tc.criticalTools) {
      if (!keptNames.has(need)) missing.push(need)
    }

    const ok = missing.length === 0 && kept.length <= LIMIT
    if (ok) passed++
    else failed++

    const num = String(i + 1).padStart(2, '0')
    const icon = ok ? '✓' : '✗'
    console.log(`\n  ${icon} #${num}  "${tc.prompt}"`)
    console.log(`     Kept: ${kept.length}/${allTools.length} tools`)
    console.log(`     Tools: [${kept.map((t) => t.name).join(', ')}]`)
    if (dropped.length > 0) {
      console.log(`     Dropped caps: [${dropped.join(', ')}]`)
    }
    if (missing.length > 0) {
      console.log(`     MISSING CRITICAL: [${missing.join(', ')}]`)
    }
    if (kept.length > LIMIT) {
      console.log(`     OVER LIMIT: ${kept.length} > ${LIMIT}`)
    }
  }

  console.log('\n' + '─'.repeat(90))
  console.log(`\n  ${passed}/${TEST_CASES.length} passed, ${failed} failed\n`)

  if (failed > 0) process.exit(1)
}

run()
