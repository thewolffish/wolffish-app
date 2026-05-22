import type { DataAnalytics, SystemInfo, WorkspaceStatus } from '@preload/index'
import {
  FlowContext,
  type ChatMessage,
  type FlowContextValue,
  type Screen
} from '@providers/flow/useFlow'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

// 5 GiB. Anything below this and Wolffish can't pull a model, persist
// conversations, or breathe — gate the entire app on it.
export const MIN_FREE_DISK_BYTES = 5 * 1024 ** 3

export function FlowProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [screen, setScreen] = useState<Screen>('welcome')
  const [returnTo, setReturnTo] = useState<Screen | null>(null)
  const [ready, setReady] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [dataAnalytics, setDataAnalytics] = useState<DataAnalytics | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)

  const decideInitialScreen = useCallback(async (): Promise<{
    screen: Screen
    status: WorkspaceStatus
  }> => {
    let s = await window.api.workspace.getStatus()

    // 0. Free disk gate. If we can't read free disk (null), don't block —
    //    let the user through and surface real errors downstream rather
    //    than stranding them on a warning they can't dismiss.
    const sys = await window.api.system.getInfo()
    if (sys.freeDiskBytes != null && sys.freeDiskBytes < MIN_FREE_DISK_BYTES) {
      return { screen: 'low-disk-space', status: s }
    }

    const selectedModel = s.config?.llm.local.model ?? null
    const ollama = await window.api.ollama.detect()

    // 1. Selected model + Ollama reachable: verify the model is still
    //    installed in Ollama. If it was removed via `ollama rm` or never
    //    actually finished pulling, clear our selection and route to picker
    //    so the user can re-select.
    if (selectedModel && ollama.reachable) {
      const installed = await window.api.ollama.listInstalled()
      const stillThere = installed.some((tag) => tag.name === selectedModel)
      if (stillThere) {
        return { screen: 'chat', status: s }
      }
      await window.api.model.clear()
      s = await window.api.workspace.getStatus()
      return { screen: 'model-picker', status: s }
    }

    // 2. Onboarding incomplete → welcome (theme/locale)
    if (!s.onboardingCompleted) {
      return { screen: 'welcome', status: s }
    }

    // 3. Ollama not reachable → setup screen
    if (!ollama.reachable) {
      return { screen: 'ollama-setup', status: s }
    }

    // 4. Ollama reachable, no model → picker
    return { screen: 'model-picker', status: s }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      decideInitialScreen(),
      window.api.data.getAnalytics(),
      window.api.system.getInfo(),
      window.api.updater.consumePostUpdate().catch(() => false)
    ]).then(([r, analytics, sys, justUpdated]) => {
      if (cancelled) return
      setStatus(r.status)
      setScreen(justUpdated && r.screen === 'chat' ? 'changelog' : r.screen)
      setDataAnalytics(analytics)
      setSystemInfo(sys)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [decideInitialScreen])

  const refreshStatus = useCallback(async () => {
    const s = await window.api.workspace.getStatus()
    setStatus(s)
  }, [])

  const refreshData = useCallback(async () => {
    const [analytics, sys] = await Promise.all([
      window.api.data.getAnalytics(),
      window.api.system.getInfo()
    ])
    setDataAnalytics(analytics)
    setSystemInfo(sys)
  }, [])

  const goTo = useCallback((next: Screen, ret?: Screen | null) => {
    if (ret !== undefined) setReturnTo(ret)
    setScreen(next)
  }, [])

  const clearModel = useCallback(async () => {
    await window.api.model.clear()
    await refreshStatus()
    setScreen('model-picker')
  }, [refreshStatus])

  const revalidateScreen = useCallback(async () => {
    const r = await decideInitialScreen()
    setStatus(r.status)
    setScreen(r.screen)
  }, [decideInitialScreen])

  const value = useMemo<FlowContextValue>(
    () => ({
      screen,
      status,
      messages,
      setMessages,
      activeConversationId,
      setActiveConversationId,
      dataAnalytics,
      systemInfo,
      refreshData,
      goTo,
      returnTo,
      refreshStatus,
      clearModel,
      revalidateScreen
    }),
    [
      screen,
      status,
      messages,
      activeConversationId,
      dataAnalytics,
      systemInfo,
      refreshData,
      goTo,
      returnTo,
      refreshStatus,
      clearModel,
      revalidateScreen
    ]
  )

  if (!ready) return <div className="bg-bg h-full w-full" aria-hidden />

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}
