export type TabKey =
  | 'appearance'
  | 'model'
  | 'channels'
  | 'services'
  | 'mcp'
  | 'updates'
  | 'wolffish'
  | 'variables'
  | 'capabilities'
  | 'knowledge'
  | 'usage'
  | 'data'

let nextTab: TabKey | null = null

export function preselectSettingsTab(tab: TabKey): void {
  nextTab = tab
}

export function consumeNextTab(): TabKey | null {
  const t = nextTab
  nextTab = null
  return t
}
