---
name: web-search
description: Search the web and read web pages for current information, documentation, news, and research
triggers:
  - search
  - google
  - look up
  - find online
  - web
  - browse
  - website
  - url
  - link
  - news
  - latest
  - current
  - today
  - recent
  - article
  - documentation
  - docs
  - what is
  - who is
  - how to
  - fetch
  - page
  - site
tools:
  - name: web_search
    description: Search the web for information. Returns titles, snippets, and URLs.
    parameters:
      query:
        type: string
        description: The search query
      maxResults:
        type: number
        required: false
        description: Maximum number of results to return (default 5, max 10)
  - name: web_fetch
    description: Fetch and read the full text content of a web page. Use after web_search to read a specific result in detail.
    parameters:
      url:
        type: string
        description: The URL of the web page to fetch
      maxLength:
        type: number
        required: false
        description: Maximum characters to return (default 15000)
danger_patterns:
  - pattern: 'web_fetch.*127\.0\.0\.1'
    level: block
    reason: SSRF — localhost access blocked
  - pattern: 'web_fetch.*localhost'
    level: block
    reason: SSRF — localhost access blocked
  - pattern: 'web_fetch.*192\.168\.'
    level: block
    reason: SSRF — private network access blocked
  - pattern: 'web_fetch.*10\.0\.'
    level: block
    reason: SSRF — private network access blocked
  - pattern: 'web_fetch.*172\.(1[6-9]|2[0-9]|3[01])\.'
    level: block
    reason: SSRF — private network access blocked
  - pattern: 'web_fetch.*file://'
    level: block
    reason: SSRF — local file access blocked
  - pattern: 'web_fetch.*\.local'
    level: block
    reason: SSRF — local network access blocked
confirm_patterns:
  - pattern: 'web_fetch.*\.(exe|msi|dmg|pkg|deb|rpm|sh|bat|ps1)$'
    reason: Fetching executable/installer content
---

# Web Search

## Tools

- `web_search` — search the web, returns titles + snippets + URLs
- `web_fetch` — fetch and read full page content from a URL

## When to use web_search

Use `web_search` when the user:
- Asks about current events, recent news, or anything time-sensitive
- Needs documentation or reference material
- Asks "what is X", "who is X", or "how to do X" and you aren't confident in your answer
- Wants to look something up, find a link, or research a topic
- Asks about something you don't have reliable knowledge about
- Needs live data (prices, weather, scores, stock info)

## When to use web_fetch

Use `web_fetch` after `web_search` when:
- The snippets from search results aren't enough to fully answer the question
- You need to read an article, documentation page, or reference in detail
- The user explicitly asks you to read or visit a specific URL

Fetch the most relevant 1–2 URLs, not all of them. Never fetch more than 3 pages in one conversation turn.

## When NOT to search

Do not search when the user is:
- Asking you to perform a local task (run a command, edit a file, create something)
- Having casual conversation or asking for opinions
- Asking about something you already know well and confidently
- Asking about their local files, system, or workspace

## How to search effectively

- Use specific queries: "Python asyncio tutorial" not "how to do async stuff"
- Include relevant keywords and terms
- If the first search doesn't answer the question, refine the query and search again
- Don't guess — search and verify

## How to present results

- Synthesize information into a natural answer — don't dump raw search results
- Cite sources when presenting factual claims
- If multiple sources disagree, mention the disagreement
- Include relevant URLs so the user can read more

## Rate limiting

If searches start failing, tell the user the search provider is temporarily unavailable and answer from your existing knowledge instead. Don't retry the same query more than twice.
