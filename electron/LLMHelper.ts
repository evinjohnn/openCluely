import { GoogleGenAI } from "@google/genai"
import fs from "fs"
import { HARD_SYSTEM_PROMPT } from "./llm/prompts"

interface OllamaResponse {
  response: string
  done: boolean
}

// Model constant for Gemini 3 Flash
const GEMINI_FLASH_MODEL = "gemini-3-flash-preview"
const GEMINI_PRO_MODEL = "gemini-3-pro-preview"

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
  private client: GoogleGenAI | null = null
  private apiKey: string | null = null
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  private geminiModel: string = GEMINI_FLASH_MODEL

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama

    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      // console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)

      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      this.apiKey = apiKey
      // Initialize with v1alpha API version for Gemini 3 support
      this.client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      })
      // console.log(`[LLMHelper] Using Google Gemini 3 with model: ${this.geminiModel} (v1alpha API)`)
    } else {
      throw new Error("Either provide Gemini API key or enable Ollama mode")
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error: any) {
      // console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        // console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        // console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      await this.callOllama("Hello")
      // console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error: any) {
      // console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          // console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError: any) {
        // console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  /**
   * Generate content using Gemini 3 Flash (text reasoning)
   * Used by IntelligenceManager for mode-specific prompts
   * NOTE: Migrated from Pro to Flash for consistency
   */
  public async generateWithPro(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    // console.log(`[LLMHelper] Calling ${GEMINI_FLASH_MODEL}...`)
    const response = await this.client.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: 256,  // Short responses for speed
        temperature: 0.3,      // Lower = faster, more focused
      }
    })
    return response.text || ""
  }

  /**
   * Generate content using Gemini 3 Flash (audio + fast multimodal)
   * CRITICAL: Audio input MUST use this model, not Pro
   */
  public async generateWithFlash(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    // console.log(`[LLMHelper] Calling ${GEMINI_FLASH_MODEL}...`)
    const response = await this.client.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: 2048,  // Increased to prevent truncation (user request)
        temperature: 0.3,      // Lower = faster, more focused
      }
    })
    return response.text || ""
  }

  /**
   * Post-process the response
   * NOTE: Truncation/clamping removed - response length is handled in prompts
   */
  private processResponse(text: string): string {
    // Basic cleaning
    let clean = this.cleanJsonResponse(text);

    // Truncation/clamping removed - prompts already handle response length
    // clean = clampResponse(clean, 3, 60);

    // Filter out fallback phrases
    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];

    if (fallbackPhrases.some(phrase => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }

    return clean;
  }

  /**
   * Retry logic with exponential backoff
   * Specifically handles 503 Service Unavailable
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 400;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e: any) {
        // Only retry on 503 or overload errors
        if (!e.message?.includes("503") && !e.message?.includes("overloaded")) throw e;

        console.warn(`[LLMHelper] 503 Overload. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error("Model busy, try again");
  }

  /**
   * Generate content using the currently selected model
   */
  private async generateContent(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    console.log(`[LLMHelper] Calling ${this.geminiModel}...`)

    return this.withRetry(async () => {
      // @ts-ignore
      const response = await this.client!.models.generateContent({
        model: this.geminiModel,
        contents: contents,
        config: {
          maxOutputTokens: 4096, // Increased to max to ensure complete responses (user request)
          temperature: 0.4,
        }
      });

      // Debug: log full response structure
      // console.log(`[LLMHelper] Full response:`, JSON.stringify(response, null, 2).substring(0, 500))

      const candidate = response.candidates?.[0];
      if (!candidate) {
        console.error("[LLMHelper] No candidates returned!");
        console.error("[LLMHelper] Full response:", JSON.stringify(response, null, 2).substring(0, 1000));
        return "";
      }

      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        console.warn(`[LLMHelper] Generation stopped with reason: ${candidate.finishReason}`);
        console.warn(`[LLMHelper] Safety ratings:`, JSON.stringify(candidate.safetyRatings));
      }

      // Try multiple ways to access text - handle different response structures
      let text = "";

      // Method 1: Direct response.text
      if (response.text) {
        text = response.text;
      }
      // Method 2: candidate.content.parts array (check all parts)
      else if (candidate.content?.parts) {
        const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [candidate.content.parts];
        for (const part of parts) {
          if (part?.text) {
            text += part.text;
          }
        }
      }
      // Method 3: candidate.content directly (if it's a string)
      else if (typeof candidate.content === 'string') {
        text = candidate.content;
      }

      if (!text || text.trim().length === 0) {
        console.error("[LLMHelper] Candidate found but text is empty.");
        console.error("[LLMHelper] Response structure:", JSON.stringify({
          hasResponseText: !!response.text,
          candidateFinishReason: candidate.finishReason,
          candidateContent: candidate.content,
          candidateParts: candidate.content?.parts,
        }, null, 2));

        if (candidate.finishReason === "MAX_TOKENS") {
          return "Response was truncated due to length limit. Please try a shorter question or break it into parts.";
        }

        return "";
      }

      console.log(`[LLMHelper] Extracted text length: ${text.length}`);
      return text;
    });
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      // Build content parts with images
      const parts: any[] = []

      for (const imagePath of imagePaths) {
        const imageData = await fs.promises.readFile(imagePath)
        parts.push({
          inlineData: {
            data: imageData.toString("base64"),
            mimeType: "image/png"
          }
        })
      }

      const prompt = `${IMAGE_ANALYSIS_PROMPT}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      parts.push({ text: prompt })

      // Use Flash for multimodal (images)
      const text = await this.generateWithFlash(parts)
      return JSON.parse(this.cleanJsonResponse(text))
    } catch (error) {
      // console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `${IMAGE_ANALYSIS_PROMPT}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    // console.log("[LLMHelper] Calling Gemini LLM for solution...");
    try {
      // Use Flash as default (Pro is experimental)
      const text = await this.generateWithFlash([{ text: prompt }])
      // console.log("[LLMHelper] Gemini LLM returned result.");
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      // console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      // console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const parts: any[] = []

      for (const imagePath of debugImagePaths) {
        const imageData = await fs.promises.readFile(imagePath)
        parts.push({
          inlineData: {
            data: imageData.toString("base64"),
            mimeType: "image/png"
          }
        })
      }

      const prompt = `${IMAGE_ANALYSIS_PROMPT}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      parts.push({ text: prompt })

      // Use Flash for multimodal (images)
      const text = await this.generateWithFlash(parts)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      // console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      // console.error("Error debugging solution with images:", error)
      throw error
    }
  }





  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath);
      const prompt = `${HARD_SYSTEM_PROMPT}\n\nDescribe the content of this image in a short, concise answer. If it contains code or a problem, solve it. \n\n${IMAGE_ANALYSIS_PROMPT}`;

      const contents = [
        { text: prompt },
        {
          inlineData: {
            mimeType: "image/png",
            data: imageData.toString("base64"),
          }
        }
      ]

      // Use Flash for multimodal
      const text = await this.generateWithFlash(contents)
      return { text, timestamp: Date.now() };
    } catch (error) {
      // console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  /**
   * Generate a suggestion based on conversation transcript - Cluely-style
   * This uses Gemini Flash to reason about what the user should say
   * @param context - The full conversation transcript
   * @param lastQuestion - The most recent question from the interviewer
   * @returns Suggested response for the user
   */
  public async generateSuggestion(context: string, lastQuestion: string): Promise<string> {
    const systemPrompt = `You are an expert interview coach. Based on the conversation transcript, provide a concise, natural response the user could say.

RULES:
- Be direct and conversational
- Keep responses under 3 sentences unless complexity requires more  
- Focus on answering the specific question asked
- If it's a technical question, provide a clear, structured answer
- Do NOT preface with "You could say" or similar - just give the answer directly
- If unsure, answer briefly and confidently anyway.
- Never hedge.
- Never say "it depends".

CONVERSATION SO FAR:
${context}

LATEST QUESTION FROM INTERVIEWER:
${lastQuestion}

ANSWER DIRECTLY:`;

    try {
      if (this.useOllama) {
        return await this.callOllama(systemPrompt);
      } else if (this.client) {
        // Use Flash model as default (Pro is experimental)
        // Wraps generateWithFlash logic but with retry
        const text = await this.generateWithFlash([{ text: systemPrompt }]);
        return this.processResponse(text);
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      //   console.error("[LLMHelper] Error generating suggestion:", error);
      // Silence error
      throw error;
    }
  }

  public async chatWithGemini(message: string, imagePath?: string, context?: string): Promise<string> {
    try {
      console.log(`[LLMHelper] chatWithGemini called with message:`, message.substring(0, 50))

      // Build context-aware prompt
      let fullMessage = `${HARD_SYSTEM_PROMPT}\n\n${message}`;
      if (context) {
        fullMessage = `${HARD_SYSTEM_PROMPT}\n\nCONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`;
      }

      // Try with current model first
      let rawResponse = await this.tryGenerateResponse(fullMessage, imagePath);

      // If response is empty/undefined, retry with same model
      if (!rawResponse || rawResponse.trim().length === 0) {
        console.warn("[LLMHelper] Empty response, retrying with same model...");
        rawResponse = await this.tryGenerateResponse(fullMessage, imagePath);
      }

      // If still empty, retry with Gemini 3 Pro
      if (!rawResponse || rawResponse.trim().length === 0) {
        console.warn("[LLMHelper] Still empty after retry, switching to Gemini 3 Pro...");
        const originalModel = this.geminiModel;
        this.geminiModel = GEMINI_PRO_MODEL;
        try {
          rawResponse = await this.tryGenerateResponse(fullMessage, imagePath);
        } finally {
          this.geminiModel = originalModel;
        }
      }

      // If still empty after all retries, return error message
      if (!rawResponse || rawResponse.trim().length === 0) {
        console.error("[LLMHelper] All retry attempts failed, returning error message");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }

      try {
        return this.processResponse(rawResponse);
      } catch (processError) {
        // If processResponse throws (e.g., filtered fallback), retry with Pro once
        console.warn("[LLMHelper] processResponse failed, retrying with Pro model...", processError);
        const originalModel = this.geminiModel;
        this.geminiModel = GEMINI_PRO_MODEL;
        try {
          const retryResponse = await this.tryGenerateResponse(fullMessage, imagePath);
          if (retryResponse && retryResponse.trim().length > 0) {
            try {
              return this.processResponse(retryResponse);
            } catch {
              // If Pro also gets filtered, return full raw response (no truncation)
              return retryResponse;
            }
          }
        } finally {
          this.geminiModel = originalModel;
        }
        return "I apologize, but I couldn't generate a response. Please try again.";
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  private async tryGenerateResponse(fullMessage: string, imagePath?: string): Promise<string> {
    let rawResponse: string;

    if (imagePath) {
      const imageData = await fs.promises.readFile(imagePath);
      const contents = [
        { text: fullMessage },
        {
          inlineData: {
            mimeType: "image/png",
            data: imageData.toString("base64")
          }
        }
      ];

      // Use current model for multimodal (allows Pro fallback)
      if (this.client) {
        rawResponse = await this.generateContent(contents);
      } else {
        throw new Error("No LLM provider configured");
      }
    } else {
      // Text-only chat
      if (this.useOllama) {
        rawResponse = await this.callOllama(fullMessage);
      } else if (this.client) {
        rawResponse = await this.generateContent([{ text: fullMessage }])
      } else {
        throw new Error("No LLM provider configured");
      }
    }

    return rawResponse || "";
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];

    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');

      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      // console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : this.geminiModel;
  }

  /**
   * Get the Gemini client for mode-specific LLMs
   * Used by AnswerLLM, AssistLLM, FollowUpLLM, RecapLLM
   * RETURNS A PROXY client that handles retries and fallbacks transparently
   */
  public getGeminiClient(): GoogleGenAI | null {
    if (!this.client) return null;
    return this.createRobustClient(this.client);
  }

  /**
   * Creates a proxy around the real Gemini client to intercept generation calls
   * and apply robust retry/fallback logic without modifying consumer code.
   */
  private createRobustClient(realClient: GoogleGenAI): GoogleGenAI {
    // We proxy the 'models' property to intercept 'generateContent'
    const modelsProxy = new Proxy(realClient.models, {
      get: (target, prop, receiver) => {
        if (prop === 'generateContent') {
          return async (args: any) => {
            return this.generateWithFallback(realClient, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    // We proxy the client itself to return our modelsProxy
    return new Proxy(realClient, {
      get: (target, prop, receiver) => {
        if (prop === 'models') {
          return modelsProxy;
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  /**
   * ROBUST GENERATION STRATEGY
   * 1. Attempt with original model (Flash)
   * 2. Retry Flash on 503/Overload (100ms, 400ms, 600ms)
   * 3. Fallback to Gemini 3 Pro (Single shot) if Flash fails
   */
  private async generateWithFallback(client: GoogleGenAI, args: any): Promise<any> {
    const GEMINI_PRO_MODEL = "gemini-3-pro-preview";
    const originalModel = args.model;

    // Retry delays in ms
    const RETRY_DELAYS = [100, 400, 600];

    // Helper to check for overload errors
    const isOverload = (error: any) => {
      const msg = error.message?.toLowerCase() || "";
      const status = error.status || 0;
      return status === 503 ||
        msg.includes("503") ||
        msg.includes("overloaded") ||
        msg.includes("busy") ||
        msg.includes("service unavailable");
    };

    // 1. Attempt Flash with Retries
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        // Use original requested model (Flash)
        return await client.models.generateContent({
          ...args,
          model: originalModel
        });
      } catch (error: any) {
        // If not an overload error, throw immediately (auth, invalid prompt, etc)
        if (!isOverload(error)) throw error;

        // If we have retries left, wait and retry
        if (attempt < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[attempt];
          // console.warn(`[LLMHelper] Flash overloaded (Attempt ${attempt+1}). Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // If we ran out of retries, verify valid fallback scenario
        console.warn(`[LLMHelper] Flash failed after 3 retries. Switching to fallback.`);
      }
    }

    // 2. Fallback to Pro (Single Attempt)
    try {
      console.log(`[LLMHelper] 🚨 Fallback triggered: Using ${GEMINI_PRO_MODEL}`);
      return await client.models.generateContent({
        ...args,
        model: GEMINI_PRO_MODEL
      });
    } catch (fallbackError: any) {
      // If Pro also fails, we must throw
      console.error(`[LLMHelper] Fallback failed:`, fallbackError);
      throw fallbackError;
    }
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;

    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }

    // console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string, modelId?: string): Promise<void> {
    if (modelId) {
      this.geminiModel = modelId;
    }

    if (apiKey) {
      this.apiKey = apiKey;
      this.client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      });
    } else if (!this.client) {
      throw new Error("No Gemini API key provided and no existing client");
    }

    this.useOllama = false;
    // console.log(`[LLMHelper] Switched to Gemini: ${this.geminiModel}`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.client) {
          return { success: false, error: "No Gemini client configured" };
        }
        // Test with a simple prompt using the selected model
        const text = await this.generateContent([{ text: "Hello" }])
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}