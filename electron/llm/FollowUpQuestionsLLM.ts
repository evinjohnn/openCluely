// electron/llm/FollowUpQuestionsLLM.ts
// MODE: Follow-Up Questions - Suggests strategic questions for the user
// Active, triggered by user request

import { GoogleGenAI } from "@google/genai";
import { MODE_CONFIGS } from "./types";
import { FOLLOW_UP_QUESTIONS_MODE_PROMPT, buildContents } from "./prompts";
import { clampResponse } from "./postProcessor";

export class FollowUpQuestionsLLM {
    private client: GoogleGenAI;
    private modelName: string;
    private config = MODE_CONFIGS.followUpQuestions;

    constructor(client: GoogleGenAI, modelName: string) {
        this.client = client;
        this.modelName = modelName;
    }

    /**
     * Generate strategic follow-up questions for the user
     * @param context - Current conversation context
     * @returns List of 3 questions
     */
    async generate(context: string): Promise<string> {
        try {
            if (!context.trim()) {
                return "";
            }

            const contents = buildContents(
                FOLLOW_UP_QUESTIONS_MODE_PROMPT,
                "Suggest MAX 4 brief follow-up questions based on this context.",
                context
            );

            const response = await this.client.models.generateContent({
                model: this.modelName,
                contents: contents,
                config: {
                    maxOutputTokens: this.config.maxOutputTokens,
                    temperature: this.config.temperature,
                    topP: this.config.topP,
                },
            });

            const rawText = response.text
                || response.candidates?.[0]?.content?.parts?.[0]?.text
                || "";

            return rawText.trim();

        } catch (error) {
            console.error("[FollowUpQuestionsLLM] Generation failed:", error);
            return "";
        }
    }
}
