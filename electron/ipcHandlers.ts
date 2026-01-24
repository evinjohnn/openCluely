// ipcHandlers.ts

import { app, ipcMain, shell } from "electron"
import { AppState } from "./main"
import { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL } from "./IntelligenceManager"

export function initializeIpcHandlers(appState: AppState): void {
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return

      const senderWebContents = event.sender
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow()
      const advancedWin = appState.settingsWindowHelper.getAdvancedWindow()

      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height)
      } else if (advancedWin && !advancedWin.isDestroyed() && advancedWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(advancedWin, width, height)
      } else {
        appState.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return appState.deleteScreenshot(path)
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error
    }
  })

  ipcMain.handle("get-screenshots", async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error
    }
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("show-window", async () => {
    appState.showMainWindow()
  })

  ipcMain.handle("hide-window", async () => {
    appState.hideMainWindow()
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      appState.clearQueues()
      // console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })



  // Generate suggestion from transcript - Cluely-style text-only reasoning
  ipcMain.handle("generate-suggestion", async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper.getLLMHelper().generateSuggestion(context, lastQuestion)
      return { suggestion }
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error
    }
  })

  // IPC handler for analyzing image from file path
  ipcMain.handle("analyze-image-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path)
      return result
    } catch (error: any) {
      // console.error("Error in analyze-image-file handler:", error)
      throw error
    }
  })

  ipcMain.handle("gemini-chat", async (event, message: string, imagePath?: string, context?: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message, imagePath, context);

      console.log(`[IPC] gemini-chat response:`, result ? result.substring(0, 50) : "(empty)");

      // Don't process empty responses
      if (!result || result.trim().length === 0) {
        console.warn("[IPC] Empty response from LLM, not updating IntelligenceManager");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }

      // Sync with IntelligenceManager so Follow-Up/Recap work
      const intelligenceManager = appState.getIntelligenceManager();

      // 1. Add user question to context (as 'user')
      // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
      // The user's manual question is a NEW input, not a refinement of previous answer.
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true
      }, true);

      // 2. Add assistant response and set as last message
      console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
      intelligenceManager.addAssistantMessage(result);
      console.log(`[IPC] Updated IntelligenceManager. Last message:`, intelligenceManager.getLastAssistantMessage()?.substring(0, 50));

      return result;
    } catch (error: any) {
      // console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // Settings Window
  ipcMain.handle("toggle-settings-window", (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y)
  })

  ipcMain.handle("close-settings-window", () => {
    appState.settingsWindowHelper.closeWindow()
  })

  ipcMain.handle("toggle-advanced-settings", () => {
    appState.settingsWindowHelper.toggleAdvancedWindow()
  })

  ipcMain.handle("close-advanced-settings", () => {
    appState.settingsWindowHelper.closeAdvancedWindow()
  })

  ipcMain.handle("set-undetectable", async (_, state: boolean) => {
    appState.setUndetectable(state)
    return { success: true }
  })

  // LLM Model Management Handlers
  ipcMain.handle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  ipcMain.handle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      // console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  ipcMain.handle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("switch-to-gemini", async (_, apiKey?: string, modelId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });



  ipcMain.handle("set-model-preference", (_, type: "flash" | "pro") => {
    try {
      const im = appState.getIntelligenceManager();
      const model = type === 'pro' ? GEMINI_PRO_MODEL : GEMINI_FLASH_MODEL;
      im.setModel(model);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("test-llm-connection", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const result = await llmHelper.testConnection();
      return result;
    } catch (error: any) {
      // console.error("Error testing LLM connection:", error);
      return { success: false, error: error.message };
    }
  });

  // Native Audio Service Handlers
  ipcMain.handle("native-audio-connect", async () => {
    appState.connectNativeAudio();
    return { success: true };
  });

  ipcMain.handle("native-audio-disconnect", async () => {
    appState.disconnectNativeAudio();
    return { success: true };
  });

  ipcMain.handle("native-audio-pause", async () => {
    appState.pauseNativeAudio();
    return { success: true };
  });

  ipcMain.handle("native-audio-resume", async () => {
    appState.resumeNativeAudio();
    return { success: true };
  });

  ipcMain.handle("native-audio-status", async () => {
    return { connected: appState.isNativeAudioConnected() };
  });

  ipcMain.handle("open-external", async (event, url: string) => {
    await shell.openExternal(url);
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  ipcMain.handle("generate-assist", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 2: What Should I Say (Primary auto-answer)
  ipcMain.handle("generate-what-to-say", async (_, question?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      // Question is now optional - IntelligenceManager infers from transcript
      const answer = await intelligenceManager.runWhatShouldISay(question);
      return { answer, question: question || 'inferred from context' };
    } catch (error: any) {
      // Return graceful fallback instead of throwing
      return {
        answer: "Could you repeat that? I want to make sure I address your question properly.",
        question: question || 'unknown'
      };
    }
  });

  // MODE 3: Follow-Up (Refinement)
  ipcMain.handle("generate-follow-up", async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  ipcMain.handle("generate-recap", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap();
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  ipcMain.handle("generate-follow-up-questions", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.runFollowUpQuestions();
      return { questions };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  ipcMain.handle("submit-manual-question", async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  ipcMain.handle("get-intelligence-context", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode()
      };
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  ipcMain.handle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
