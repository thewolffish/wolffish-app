import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from '@providers/theme/ThemeProvider'
import { LocaleProvider } from '@providers/locale/LocaleProvider'
import { FlowProvider } from '@providers/flow/FlowProvider'
import { useFlow, type Screen } from '@providers/flow/useFlow'
import { ChatSessionsProvider } from '@providers/sessions/ChatSessionsProvider'
import { useSessions } from '@providers/sessions/useSessions'
import { ConversationsSidebar } from '@components/common/sidebar/ConversationsSidebar'
import { ToastProvider } from '@components/core/toast/ToastProvider'
import { useToast } from '@components/core/toast/useToast'
import { InputContextMenu } from '@components/core/InputContextMenu'
import { useNetworkToasts } from '@hooks/use-network-toasts/useNetworkToasts'
import { ClosingOverlay } from '@components/common/closing-overlay/ClosingOverlay'
import { HeartbeatActiveOverlay } from '@components/common/heartbeat-active-overlay/HeartbeatActiveOverlay'
import { ProcedureActiveOverlay } from '@components/common/procedure-active-overlay/ProcedureActiveOverlay'
import { ReindexActiveOverlay } from '@components/common/reindex-active-overlay/ReindexActiveOverlay'
import { Onboarding } from '@pages/Onboarding'
import { LowDiskSpace } from '@pages/LowDiskSpace'
import { OllamaSetup } from '@pages/OllamaSetup'
import { ModelPicker } from '@pages/ModelPicker'
import { Chat } from '@pages/Chat'
import { Settings } from '@pages/settings/Settings'
import { ViewerPage } from '@pages/ViewerPage'
import { History } from '@pages/History'
import { Changelog } from '@pages/Changelog'
import { Heartbeat } from '@pages/Heartbeat'
import { Procedures } from '@pages/Procedures'
import { Projects } from '@pages/Projects'
import { Soul } from '@pages/Soul'
import { User } from '@pages/User'
import { Agents } from '@pages/Agents'

// A background run blocks everything (jobs run one-at-a-time), so while one runs
// we swap the active screen for a live overlay. Both automations and procedures
// run through the same brainstem queue, so they share the window.api.heartbeat.*
// run channel; we tell them apart by the job id ("procedure:" prefix ⇒ a
// procedure run) and show the matching overlay. Centralized here so every page
// is covered without each one wiring it up.
type ActiveRun = 'heartbeat' | 'procedure' | null

const runKind = (id: string): Exclude<ActiveRun, null> =>
  id.startsWith('procedure:') ? 'procedure' : 'heartbeat'

// A run that dies because every provider attempt failed surfaces the raw
// ProviderFailure.reasonKey as its error (wernicke joins them with '; '), so
// payload.error arrives as a bare machine key like "offline". Map those to
// short toast-sized reasons; anything unrecognized is a real exception
// message and passes through (clamped so a stack-ish string can't balloon
// the toast).
const PROVIDER_REASON_MESSAGE: Record<string, string> = {
  offline: 'errors.runFailedReason.offline',
  'authentication failed': 'errors.runFailedReason.invalidKey',
  forbidden: 'errors.runFailedReason.invalidKey',
  'model not found': 'errors.runFailedReason.modelNotFound',
  'rate-limited': 'errors.runFailedReason.rateLimited',
  'bad request': 'errors.runFailedReason.badRequest',
  timeout: 'errors.runFailedReason.timeout',
  'server error': 'errors.runFailedReason.serverError',
  'gateway error': 'errors.runFailedReason.serverError',
  unavailable: 'errors.runFailedReason.serverError',
  overloaded: 'errors.runFailedReason.serverError'
}

const RAW_ERROR_TOAST_LIMIT = 100

const clampToastDetail = (text: string): string =>
  text.length <= RAW_ERROR_TOAST_LIMIT
    ? text
    : `${text.slice(0, RAW_ERROR_TOAST_LIMIT - 1).trimEnd()}…`

function useActiveRun(): ActiveRun {
  const { t } = useTranslation()
  const toast = useToast()
  const [active, setActive] = useState<ActiveRun>(null)
  useEffect(() => {
    let cancelled = false
    window.api.heartbeat
      .getRunningJob()
      .then((job) => {
        if (!cancelled) setActive(job ? runKind(job.id) : null)
      })
      .catch(() => {})
    const offStarted = window.api.heartbeat.onJobStarted((job) => setActive(runKind(job.id)))
    const offEnded = window.api.heartbeat.onJobEnded((payload) => {
      setActive(null)
      // A run that fails mid-execution has no other surface once the overlay
      // closes, so surface the failure as a toast: what failed, then why.
      if (payload.status === 'failed') {
        const title = t(
          payload.id.startsWith('procedure:') ? 'procedures.runFailed' : 'heartbeat.runFailed'
        )
        const reasonKey = PROVIDER_REASON_MESSAGE[payload.error?.split(';')[0]?.trim() ?? '']
        const detail = reasonKey ? t(reasonKey) : payload.error && clampToastDetail(payload.error)
        toast.show({
          tone: 'error',
          message: detail ? `${title} — ${detail}` : title
        })
      }
    })
    return () => {
      cancelled = true
      offStarted()
      offEnded()
    }
  }, [t, toast])
  return active
}

// The one-time cortex reindex (after an app update) blocks every turn, so
// while it runs the chat screen is swapped for its own overlay. Tracked here —
// not inside Chat — so the overlay renders once at app level and the
// conversations rail hides behind the same chatVisible gate as the
// heartbeat/procedure overlays. When Chat owned this state the rail (a fixed
// z-30 element gated only at app level) kept floating over the overlay, and
// every mounted session rendered its own duplicate copy.
function useReindexActive(): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    let cancelled = false
    window.api.reindex
      .getStatus()
      .then((s) => {
        if (!cancelled) setActive(!!s)
      })
      .catch(() => {})
    const offStarted = window.api.reindex.onStarted(() => setActive(true))
    const offEnded = window.api.reindex.onEnded(() => setActive(false))
    return () => {
      cancelled = true
      offStarted()
      offEnded()
    }
  }, [])
  return active
}

// Screens the user can reach WHILE holding live conversations. Chat sessions
// stay mounted for the whole set so navigating anywhere and back never tears
// live state down — with concurrent sessions, an unmount would silently
// reset every feed to its open-time seed and orphan in-flight turns.
// ollama-setup and model-picker are included because both are reachable
// mid-session (Settings' "install Ollama" button, clearing the model);
// only the pre-conversation launch screens (welcome, low-disk-space) stay
// out — no session can exist there yet.
const CHAT_KEEPALIVE_SCREENS = new Set<Screen>([
  'chat',
  'settings',
  'viewer',
  'history',
  'changelog',
  'heartbeat',
  'procedures',
  'projects',
  'soul',
  'user',
  'agents',
  'ollama-setup',
  'model-picker'
])

// Every screen EXCEPT chat, which is rendered persistently by Screens() so its
// live state (context meter, timeline, scroll, in-flight stream) survives
// navigation instead of reloading on every return.
function NonChatScreen({ screen }: { screen: Screen }): React.JSX.Element | null {
  switch (screen) {
    case 'welcome':
      return <Onboarding />
    case 'low-disk-space':
      return <LowDiskSpace />
    case 'ollama-setup':
      return <OllamaSetup />
    case 'model-picker':
      return <ModelPicker />
    case 'chat':
      return null
    case 'settings':
      return <Settings />
    case 'viewer':
      return <ViewerPage />
    case 'history':
      return <History />
    case 'changelog':
      return <Changelog />
    case 'heartbeat':
      return <Heartbeat />
    case 'procedures':
      return <Procedures />
    case 'projects':
      return <Projects />
    case 'soul':
      return <Soul />
    case 'user':
      return <User />
    case 'agents':
      return <Agents />
  }
}

// Global network-status notifier — mounted once inside ToastProvider so the
// drop/restore toasts show on every screen, not just the ones that track
// connectivity themselves.
function NetworkToasts(): null {
  useNetworkToasts()
  return null
}

function Screens(): React.JSX.Element {
  const { screen } = useFlow()
  const { sessions, activeSessionKey } = useSessions()
  const activeRun = useActiveRun()
  const reindexActive = useReindexActive()
  // Keep every chat SESSION mounted (just hidden) across main-app navigation
  // AND during a background run. One <Chat> instance per open session: each
  // owns its own feed, composer, meter and in-flight turn, so conversations
  // stream concurrently and switching between them never tears live state
  // down. `contents` makes the active wrapper layout-invisible so the chat
  // view renders exactly as it would unwrapped; `hidden` (display:none) takes
  // the rest out of layout without unmounting — no reload, no reset, no flash.
  //
  // Critically, staying mounted is what keeps a background conversation's
  // output from being lost: an electron conversation is persisted only by its
  // renderer instance, so unmounting a Chat mid-turn would drop the turn
  // before it saves. Mounted-but-hidden, each Chat still receives its own
  // turn's events (demuxed by conversationId/turnId) and persists them.
  const chatMounted = CHAT_KEEPALIVE_SCREENS.has(screen)
  // !reindexActive: while the reindex overlay is up, the chat (and with it the
  // conversations rail below) hides exactly as it does for the run overlays —
  // display:none, never unmounted, so live state survives the rebuild.
  const chatVisible = chatMounted && screen === 'chat' && activeRun === null && !reindexActive
  return (
    <>
      {activeRun === 'procedure' ? (
        <ProcedureActiveOverlay />
      ) : activeRun === 'heartbeat' ? (
        <HeartbeatActiveOverlay />
      ) : reindexActive && screen === 'chat' ? (
        <ReindexActiveOverlay />
      ) : (
        <NonChatScreen screen={screen} />
      )}
      {chatMounted &&
        sessions.map((session) => {
          const show = chatVisible && session.key === activeSessionKey
          return (
            <div key={session.key} className={show ? 'contents' : 'hidden'}>
              <Chat sessionKey={session.key} visible={show} descriptor={session} />
            </div>
          )
        })}
      {/* ONE app-level conversations rail — mounted whenever the chat is,
          hidden (not unmounted) when it isn't. Rendering it per-Chat-instance
          made opening an unloaded conversation spawn a fresh session whose new
          rail reset to empty and re-fetched — a visible flicker on every
          switch. A single persistent instance never remounts. */}
      {chatMounted && (
        <div className={chatVisible ? 'contents' : 'hidden'}>
          <ConversationsSidebar />
        </div>
      )}
    </>
  )
}

// Electron's default action for a file dropped anywhere in the window is to
// navigate to it (file://…), which blanks the app. Registered dropzones handle
// their own drops; this guard swallows every other drop so a near-miss can't
// hijack the window. React's onDrop handlers still fire — they run on the root
// container during bubbling, before this window-level listener.
function useGlobalDropGuard(): void {
  useEffect(() => {
    const prevent = (e: DragEvent): void => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault()
      }
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])
}

function App(): React.JSX.Element {
  useGlobalDropGuard()
  return (
    <ThemeProvider>
      <LocaleProvider>
        <ToastProvider>
          <NetworkToasts />
          <FlowProvider>
            <ChatSessionsProvider>
              <div className="app-titlebar" aria-hidden />
              <Screens />
              <ClosingOverlay />
              <InputContextMenu />
            </ChatSessionsProvider>
          </FlowProvider>
        </ToastProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}

export default App
