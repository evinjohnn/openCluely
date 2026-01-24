// electron/llm/types.ts
// Shared types for the Cluely LLM system

import { GoogleGenAI } from "@google/genai";

/**
 * Generation configuration for Gemini calls
 */
export interface GenerationConfig {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
}

/**
 * Mode-specific token limits
 */
export const MODE_CONFIGS = {
    answer: {
        maxOutputTokens: 256,  // Let model generate, post-processor will clamp
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    assist: {
        maxOutputTokens: 128,  // Shorter for insights
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    followUp: {
        maxOutputTokens: 1024,
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    recap: {
        maxOutputTokens: 1024,  // More for summaries
        temperature: 0.25,
        topP: 0.85,
    } as GenerationConfig,

    followUpQuestions: {
        maxOutputTokens: 512,
        temperature: 0.4, // Slightly higher creative freedom
        topP: 0.9,
    } as GenerationConfig,
} as const;

/**
 * Gemini content structure
 */
export interface GeminiContent {
    role: "user" | "model";
    parts: { text: string }[];
}

/**
 * LLM client interface for dependency injection
 */
export interface LLMClient {
    getGeminiClient(): GoogleGenAI | null;
}
