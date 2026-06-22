import { useEffect } from 'react'
import { ThemeProvider } from '@providers/theme/ThemeProvider'
import { LocaleProvider } from '@providers/locale/LocaleProvider'
import { FlowProvider } from '@providers/flow/FlowProvider'
import { useFlow } from '@providers/flow/useFlow'
import { ToastProvider } from '@components/core/toast/ToastProvider'
import { InputContextMenu } from '@components/core/InputContextMenu'
import { ClosingOverlay } from '@components/common/closing-overlay/ClosingOverlay'
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

function Screens(): React.JSX.Element {
  const { screen } = useFlow()
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
