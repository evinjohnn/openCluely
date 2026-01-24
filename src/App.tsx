import React from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/CluelyInterface"
import SettingsPopup from "./components/SettingsPopup"
import AdvancedSettings from "./components/AdvancedSettings"

const queryClient = new QueryClient()

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isAdvancedWindow = new URLSearchParams(window.location.search).get('window') === 'advanced';

  return (
    <div className="h-full min-h-0 w-full">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {isSettingsWindow ? <SettingsPopup /> :
            isAdvancedWindow ? <AdvancedSettings /> :
              <NativelyInterface />}
          <ToastViewport />
        </ToastProvider>
      </QueryClientProvider>
    </div>
  )
}

export default App
