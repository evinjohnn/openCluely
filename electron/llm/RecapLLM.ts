import { GoogleGenAI } from "@google/genai";
import { MODE_CONFIGS } from "./types";
import { buildRecapContents } from "./prompts";
import { clampResponse } from "./postProcessor";

const GEMINI_FLASH_MODEL = "gemini-3-flash-preview";

export class RecapLLM {
    private client: GoogleGenAI;
    private modelName: string;
    private config = MODE_CONFIGS.recap;

    constructor(client: GoogleGenAI, modelName: string) {
        this.client = client;
        this.modelName = modelName;
    }

    /**
     * Generate a neutral conversation summary
     * @param context - Full conversation to summarize
     * @returns Bullet-point summary (3-5 points)
     */
    async generate(context: string): Promise<string> {
        try {
            if (!context.trim()) {
                return "";
            }

            const contents = buildRecapContents(context);

            const response = await this.client.models.generateContent({
                model: this.modelName,
                contents: contents,
                config: {
                    maxOutputTokens: this.config.maxOutputTokens,
                    temperature: this.config.temperature,
                    topP: this.config.topP,
                },
            });

            // Extract text handling potential missing top-level text property
            const rawText = response.text
                || response.candidates?.[0]?.content?.parts?.[0]?.text
                || "";

            // Recap allows bullets and more words, but still clamped
            // Don't strip bullets for recap, just limit length
            return clampRecapResponse(rawText);

        } catch (error) {
            console.error("[RecapLLM] Generation failed:", error);
            return "";
        }
    }
}

/**
 * Special clamp for recap - allows bullets, limits to 5 points
 */
function clampRecapResponse(text: string): string {
    if (!text || typeof text !== "string") {
        return "";
    }

    let result = text.trim();

    // Remove headers
    result = result.replace(/^#{1,6}\s+/gm, "");

    // Remove bold/italic markdown but keep bullets
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
    result = result.replace(/__([^_]+)__/g, "$1");

    // Split by bullet points or newlines
    const lines = result.split(/\n/).filter(line => line.trim());

    // Take at most 5 bullet points
    const clamped = lines.slice(0, 5);

    return clamped.join("\n").trim();
}
