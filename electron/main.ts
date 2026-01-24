import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron"

// Handle stdout/stderr errors at the process level to prevent EIO crashes
// This is critical for Electron apps that may have their terminal detached
process.stdout?.on?.('error', () => { });
process.stderr?.on?.('error', () => { });

// Safe console wrapper to prevent EIO errors in detached process
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: any[]) => {
  try {
    originalLog.apply(console, args);
  } catch {
    // Silently ignore all console write errors (EIO, EPIPE, etc.)
  }
};

console.warn = (...args: any[]) => {
  try {
    originalWarn.apply(console, args);
  } catch {
    // Silently ignore all console write errors (EIO, EPIPE, etc.)
  }
};

console.error = (...args: any[]) => {
  try {
    originalError.apply(console, args);
  } catch {
    // Silently ignore all console write errors (EIO, EPIPE, etc.)
  }
};

import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { SettingsWindowHelper } from "./SettingsWindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { ProcessingHelper } from "./ProcessingHelper"
import { NativeAudioClient, TranscriptSegment, SuggestionTrigger, ServiceStatus } from "./NativeAudioClient"
import { IntelligenceManager } from "./IntelligenceManager"

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  private screenshotHelper: ScreenshotHelper
  public shortcutsHelper: ShortcutsHelper
  public processingHelper: ProcessingHelper
  private nativeAudioClient: NativeAudioClient
  private intelligenceManager: IntelligenceManager
  private tray: Tray | null = null

  // View management
  private view: "queue" | "solutions" = "queue"

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false

  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // Initialize WindowHelper with this
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()

    // Initialize ScreenshotHelper
    this.screenshotHelper = new ScreenshotHelper(this.view)

    // Initialize ProcessingHelper
    this.processingHelper = new ProcessingHelper(this)

    // Initialize ShortcutsHelper
    this.shortcutsHelper = new ShortcutsHelper(this)

    // Initialize NativeAudioClient for real-time transcription
    this.nativeAudioClient = new NativeAudioClient()

    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())
    this.setupNativeAudioEvents()
    this.setupIntelligenceEvents()
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)

    // Forward intelligence events to renderer
    this.intelligenceManager.on('assist_update', (insight: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-assist-update', { insight })
      }
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer', { answer, question, confidence })
      }
      // Also send to native service for context storage
      this.nativeAudioClient.sendAssistantSuggestion(answer)
    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer-token', { token, question, confidence })
      }
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer-token', { token, intent })
      }
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer', { answer, intent })
      }
      // Also send to native service for context storage
      this.nativeAudioClient.sendAssistantSuggestion(answer)
    })

    this.intelligenceManager.on('recap', (summary: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap', { summary })
      }
    })

    this.intelligenceManager.on('recap_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap-token', { token })
      }
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-update', { questions })
      }
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-token', { token })
      }
    })

    this.intelligenceManager.on('manual_answer_started', () => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-started')
      }
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-result', { answer, question })
      }
      // Also send to native service for context storage
      this.nativeAudioClient.sendAssistantSuggestion(answer)
    })

    this.intelligenceManager.on('mode_changed', (mode: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-mode-changed', { mode })
      }
    })

    this.intelligenceManager.on('error', (error: Error, mode: string) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-error', { error: error.message, mode })
      }
    })
  }

  private setupNativeAudioEvents(): void {
    // Forward transcripts to renderer AND to IntelligenceManager
    this.nativeAudioClient.on('transcript', (transcript: TranscriptSegment) => {
      // Feed to IntelligenceManager for context building
      this.intelligenceManager.handleTranscript(transcript)

      const mainWindow = this.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('native-audio-transcript', transcript)
      }
    })

    // Forward suggestion triggers to IntelligenceManager for proper mode handling
    this.nativeAudioClient.on('suggestion', async (suggestion: SuggestionTrigger) => {
      const mainWindow = this.getMainWindow()

      // Notify renderer that we're processing a suggestion
      if (mainWindow) {
        mainWindow.webContents.send('native-audio-suggestion', suggestion)
        mainWindow.webContents.send('suggestion-processing-start')
      }

      // Use IntelligenceManager for proper mode-specific handling
      try {
        console.log('[NativeAudio] Triggering WhatShouldISay mode for:', suggestion.lastQuestion.substring(0, 50) + '...')
        await this.intelligenceManager.handleSuggestionTrigger(suggestion)
        // Events are emitted by IntelligenceManager and forwarded via setupIntelligenceEvents
      } catch (error) {
        console.error('[NativeAudio] Error handling suggestion trigger:', error)
        if (mainWindow) {
          mainWindow.webContents.send('suggestion-error', { error: String(error) })
        }
      }
    })

    // Forward status updates to renderer
    this.nativeAudioClient.on('status', (status: ServiceStatus) => {
      const mainWindow = this.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('native-audio-status', status)
      }
    })

    this.nativeAudioClient.on('connected', () => {
      console.log('[NativeAudio] Connected to native audio service')
      const mainWindow = this.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('native-audio-connected')
      }
    })

    this.nativeAudioClient.on('disconnected', () => {
      console.log('[NativeAudio] Disconnected from native audio service')
      const mainWindow = this.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('native-audio-disconnected')
      }
    })
  }

  public connectNativeAudio(): void {
    this.nativeAudioClient.connect()
  }

  public disconnectNativeAudio(): void {
    this.nativeAudioClient.disconnect()
  }

  public isNativeAudioConnected(): boolean {
    return this.nativeAudioClient.isConnected()
  }

  public pauseNativeAudio(): void {
    this.nativeAudioClient.pause()
  }

  public resumeNativeAudio(): void {
    this.nativeAudioClient.resume()
  }

  public sendAssistantSuggestion(suggestion: string): void {
    this.nativeAudioClient.sendAssistantSuggestion(suggestion)
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )
    this.windowHelper.toggleMainWindow()
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  // Screenshot management methods
  public async takeScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    const screenshotPath = await this.screenshotHelper.takeScreenshot(
      () => this.hideMainWindow(),
      () => this.showMainWindow()
    )

    return screenshotPath
  }

  public async takeSelectiveScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    const screenshotPath = await this.screenshotHelper.takeSelectiveScreenshot(
      () => this.hideMainWindow(),
      () => this.showMainWindow()
    )

    return screenshotPath
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    const iconPath = process.env.NODE_ENV === 'development'
      ? require('path').join(__dirname, '../src/components/icon.png')
      : require('path').join(process.resourcesPath, 'src/components/icon.png');

    // For now, let's use a simpler path for local development testing
    // In production, we'd need to ensure it's bundled.
    const trayIcon = nativeImage.createFromPath(require('path').join(app.getAppPath(), 'src/components/icon.png')).resize({ width: 16, height: 16 });

    this.tray = new Tray(trayIcon)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Natively',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: 'Toggle Window',
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Take Screenshot (Cmd+H)',
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setToolTip('Natively - Press Cmd+Shift+Space to show')
    this.tray.setContextMenu(contextMenu)

    // Set a title for macOS (will appear in menu bar)
    if (process.platform === 'darwin') {
      // Tray now uses icon.png, no title needed
    }

    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }

  public setUndetectable(state: boolean): void {
    this.windowHelper.setContentProtection(state)
    this.settingsWindowHelper.setContentProtection(state)
  }
}

// Application initialization
async function initializeApp() {
  const appState = AppState.getInstance()

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  app.whenReady().then(() => {
    console.log("App is ready")
    appState.createWindow()
    appState.createTray()
    // Register global shortcuts using ShortcutsHelper
    appState.shortcutsHelper.registerGlobalShortcuts()

    // Pre-create settings window in background for faster first open
    appState.settingsWindowHelper.preloadWindow()

    // Connect to native audio service
    appState.connectNativeAudio()
    console.log("Native audio client connecting...")
  })

  app.on("activate", () => {
    console.log("App activated")
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.dock?.hide() // Hide dock icon (optional)
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
