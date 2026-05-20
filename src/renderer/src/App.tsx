import { ThemeProvider } from '@providers/theme/ThemeProvider'
import { LocaleProvider } from '@providers/locale/LocaleProvider'
import { FlowProvider } from '@providers/flow/FlowProvider'
import { useFlow } from '@providers/flow/useFlow'
import { ToastProvider } from '@components/core/toast/ToastProvider'
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
  }
}

function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <ToastProvider>
          <FlowProvider>
            <div className="app-titlebar" aria-hidden />
            <Screens />
            <ClosingOverlay />
          </FlowProvider>
        </ToastProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}

export default App
