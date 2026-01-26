import React, { useState } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/CluelyInterface"
import SettingsPopup from "./components/SettingsPopup" // Keeping for legacy/specific window support if needed
import AdvancedSettings from "./components/AdvancedSettings"
import Launcher from "./components/Launcher"
import SettingsOverlay from "./components/SettingsOverlay"

const queryClient = new QueryClient()

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isAdvancedWindow = new URLSearchParams(window.location.search).get('window') === 'advanced';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isAdvancedWindow && !isOverlayWindow;

  // State
  // We no longer need 'view' state for routing, but we might need it internally or just tracking
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Handlers
  const handleStartMeeting = async () => {
    try {
      const result = await window.electronAPI.startMeeting();
      if (result.success) {
        // Switch to Overlay Mode via IPC
        // The main process handles window switching, but we can reinforce it or just trust main.
        // Actually, main process startMeeting triggers nothing UI-wise unless we tell it to switch window
        // But we configured main.ts to not auto-switch?
        // Let's explicitly request mode change.
        await window.electronAPI.setWindowMode('overlay');
      } else {
        console.error("Failed to start meeting:", result.error);
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
    }
  };

  const handleEndMeeting = async () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    try {
      await window.electronAPI.endMeeting();
      console.log("[App.tsx] endMeeting IPC completed");
      // Switch back to Native Launcher Mode
      await window.electronAPI.setWindowMode('launcher');
    } catch (err) {
      console.error("Failed to end meeting:", err);
      window.electronAPI.setWindowMode('launcher');
    }
  };

  // Render Logic
  if (isSettingsWindow) {
    return (
      <div className="h-full min-h-0 w-full">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SettingsPopup />
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    );
  }

  if (isAdvancedWindow) {
    return (
      <div className="h-full min-h-0 w-full">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AdvancedSettings />
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    );
  }

  // --- OVERLAY WINDOW (Meeting Interface) ---
  if (isOverlayWindow) {
    return (
      <div className="h-full min-h-0 w-full relative bg-transparent">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <NativelyInterface
              onEndMeeting={handleEndMeeting}
            />
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    );
  }

  // --- LAUNCHER WINDOW (Default) ---
  // Renders if window=launcher OR no param
  return (
    <div className="h-full min-h-0 w-full relative">


      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Launcher
            onStartMeeting={handleStartMeeting}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
          <SettingsOverlay
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />
          <ToastViewport />
        </ToastProvider>
      </QueryClientProvider>
    </div>
  )
}

export default App
