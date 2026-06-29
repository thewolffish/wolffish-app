import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from '@providers/theme/ThemeProvider'
import { LocaleProvider } from '@providers/locale/LocaleProvider'
import { FlowProvider } from '@providers/flow/FlowProvider'
import { useFlow } from '@providers/flow/useFlow'
import { ToastProvider } from '@components/core/toast/ToastProvider'
import { useToast } from '@components/core/toast/useToast'
import { InputContextMenu } from '@components/core/InputContextMenu'
import { ClosingOverlay } from '@components/common/closing-overlay/ClosingOverlay'
import { HeartbeatActiveOverlay } from '@components/common/heartbeat-active-overlay/HeartbeatActiveOverlay'
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
import { Soul } from '@pages/Soul'
import { User } from '@pages/User'
import { Agents } from '@pages/Agents'

// A heartbeat job blocks everything (jobs run one-at-a-time), so while one runs
// we swap the active screen for the live overlay. Centralized here so every page
// is covered without each one wiring it up.
function useHeartbeatActive(): boolean {
  const { t } = useTranslation()
  const toast = useToast()
  const [active, setActive] = useState(false)
  useEffect(() => {
    let cancelled = false
    window.api.heartbeat
      .getRunningJob()
      .then((job) => {
        if (!cancelled) setActive(!!job)
      })
      .catch(() => {})
    const offStarted = window.api.heartbeat.onJobStarted(() => setActive(true))
    const offEnded = window.api.heartbeat.onJobEnded((payload) => {
      setActive(false)
      // A run that fails mid-execution has no other surface once the overlay
      // closes, so surface the failure as a toast.
      if (payload.status === 'failed') {
        toast.show({ tone: 'error', message: payload.error ?? t('heartbeat.runFailed') })
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

function Screens(): React.JSX.Element {
  const { screen } = useFlow()
  const heartbeatActive = useHeartbeatActive()
  if (heartbeatActive) return <HeartbeatActiveOverlay />
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
      return <Chat />
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
    case 'soul':
      return <Soul />
    case 'user':
      return <User />
    case 'agents':
      return <Agents />
  }
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
          <FlowProvider>
            <div className="app-titlebar" aria-hidden />
            <Screens />
            <ClosingOverlay />
            <InputContextMenu />
          </FlowProvider>
        </ToastProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}

export default App
