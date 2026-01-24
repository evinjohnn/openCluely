// IntelligenceManager.ts
// Central orchestrator for the 5-mode intelligence layer
// Uses mode-specific LLMs for Natively-style interview copilot

import { EventEmitter } from 'events';
import { TranscriptSegment, SuggestionTrigger } from './NativeAudioClient';
import { LLMHelper } from './LLMHelper';
import { AnswerLLM, AssistLLM, FollowUpLLM, RecapLLM, FollowUpQuestionsLLM, WhatToAnswerLLM, prepareTranscriptForWhatToAnswer } from './llm';

export const GEMINI_FLASH_MODEL = "gemini-3-flash-preview";
export const GEMINI_PRO_MODEL = "gemini-3-pro-preview";

// Refinement intent detection (refined to avoid false positives)
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const lowercased = userText.toLowerCase().trim();
    const refinementPatterns = [
        { pattern: /make it shorter|shorten this|be brief/i, intent: 'shorten' },
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        { pattern: /give me an example|provide an instance/i, intent: 'add_example' },
        { pattern: /make it more confident|be more assertive|sound stronger/i, intent: 'more_confident' },
        { pattern: /make it casual|be less formal|sound relaxed/i, intent: 'more_casual' },
        { pattern: /make it formal|be more professional|sound professional/i, intent: 'more_formal' },
        { pattern: /simplify this|make it simpler|explain specifically/i, intent: 'simplify' },
    ];

    for (const { pattern, intent } of refinementPatterns) {
        if (pattern.test(lowercased)) {
            return { isRefinement: true, intent };
        }
    }

    return { isRefinement: false, intent: '' };
}

// Context item matching Swift ContextManager structure
export interface ContextItem {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
}

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'what_to_say' | 'follow_up' | 'recap' | 'manual' | 'follow_up_questions';

// Events emitted by IntelligenceManager
export interface IntelligenceModeEvents {
    'assist_update': (insight: string) => void;
    'suggested_answer': (answer: string, question: string, confidence: number) => void;
    'refined_answer': (answer: string, intent: string) => void;
    'recap': (summary: string) => void;
    'follow_up_questions_update': (questions: string) => void;
    'manual_answer_started': () => void;
    'manual_answer_result': (answer: string, question: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode) => void;
}

/**
 * IntelligenceManager - Central orchestrator for all intelligence modes
 * Now uses mode-specific LLMs with strict token limits and post-processing
 * 
 * Modes:
 * 1. Assist (passive) - Low-priority insights, cancelable
 * 2. WhatShouldISay (primary) - Auto-triggered answers
 * 3. FollowUp (refinement) - Operate on last assistant message  
 * 4. Recap (summary) - Manual or auto on long conversations
 * 5. Manual (fallback) - Explicit user bypass
 */
export class IntelligenceManager extends EventEmitter {
    // Context management (mirrors Swift ContextManager)
    private contextItems: ContextItem[] = [];
    private readonly contextWindowDuration: number = 120; // 120 seconds
    private readonly maxContextItems: number = 500;

    // Last assistant message for follow-up mode
    private lastAssistantMessage: string | null = null;

    // Mode state
    private activeMode: IntelligenceMode = 'idle';
    private assistCancellationToken: AbortController | null = null;

    // Mode-specific LLMs (new architecture)
    private answerLLM: AnswerLLM | null = null;
    private assistLLM: AssistLLM | null = null;
    private followUpLLM: FollowUpLLM | null = null;
    private recapLLM: RecapLLM | null = null;
    private followUpQuestionsLLM: FollowUpQuestionsLLM | null = null;
    private whatToAnswerLLM: WhatToAnswerLLM | null = null;

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds
    private currentModel: string = GEMINI_FLASH_MODEL;

    constructor(llmHelper: LLMHelper) {
        super();
        this.llmHelper = llmHelper;
        this.initializeModeLLMs();
    }

    /**
     * Initialize mode-specific LLMs with shared Gemini client
     */
    private initializeModeLLMs(): void {
        const client = this.llmHelper.getGeminiClient();
        if (client) {
            this.answerLLM = new AnswerLLM(client, this.currentModel);
            this.assistLLM = new AssistLLM(client, this.currentModel);
            this.followUpLLM = new FollowUpLLM(client, this.currentModel);
            this.recapLLM = new RecapLLM(client, this.currentModel);
            this.followUpQuestionsLLM = new FollowUpQuestionsLLM(client, this.currentModel);
            this.whatToAnswerLLM = new WhatToAnswerLLM(client, this.currentModel);
        }
    }

    public setModel(modelName: string): void {
        console.log(`[IntelligenceManager] Switching model to: ${modelName}`);
        this.currentModel = modelName;
        this.initializeModeLLMs();
        this.llmHelper.switchToGemini(undefined, modelName);
    }

    // ============================================
    // Context Management (mirrors Swift ContextManager)
    // ============================================

    /**
     * Add a transcript segment to context
     * Only stores FINAL transcripts
     */
    addTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        if (!segment.final) return;

        const role = this.mapSpeakerToRole(segment.speaker);
        const text = segment.text.trim();

        if (!text) return;

        // Deduplicate: check if this exact item already exists
        const lastItem = this.contextItems[this.contextItems.length - 1];
        if (lastItem &&
            lastItem.role === role &&
            Math.abs(lastItem.timestamp - segment.timestamp) < 500 &&
            lastItem.text === text) {
            return;
        }

        this.contextItems.push({
            role,
            text,
            timestamp: segment.timestamp
        });

        this.evictOldEntries();
        this.lastTranscriptTime = Date.now();

        // Check for follow-up intent if user is speaking
        if (!skipRefinementCheck && role === 'user' && this.lastAssistantMessage) {
            const { isRefinement, intent } = detectRefinementIntent(text);
            if (isRefinement) {
                this.runFollowUp(intent, text);
            }
        }
    }

    /**
     * Add assistant-generated message to context
     */
    addAssistantMessage(text: string): void {
        console.log(`[IntelligenceManager] addAssistantMessage called with:`, text.substring(0, 50));

        // Natively-style filtering
        if (!text) return;

        const cleanText = text.trim();
        if (cleanText.length < 10) {
            console.warn(`[IntelligenceManager] Ignored short message (<10 chars)`);
            return;
        }

        if (cleanText.includes("I'm not sure") || cleanText.includes("I can't answer")) {
            console.warn(`[IntelligenceManager] Ignored fallback message`);
            return;
        }

        this.contextItems.push({
            role: 'assistant',
            text: cleanText,
            timestamp: Date.now()
        });

        this.lastAssistantMessage = cleanText;
        console.log(`[IntelligenceManager] lastAssistantMessage updated`);
        this.evictOldEntries();
    }

    /**
     * Get context items within the last N seconds
     */
    getContext(lastSeconds: number = 120): ContextItem[] {
        const cutoff = Date.now() - (lastSeconds * 1000);
        return this.contextItems.filter(item => item.timestamp >= cutoff);
    }

    /**
     * Get the last assistant message
     */
    getLastAssistantMessage(): string | null {
        return this.lastAssistantMessage;
    }

    /**
     * Get formatted context string for LLM prompts
     */
    getFormattedContext(lastSeconds: number = 120): string {
        const items = this.getContext(lastSeconds);
        return items.map(item => {
            const label = item.role === 'interviewer' ? 'INTERVIEWER' :
                item.role === 'user' ? 'ME' :
                    'ASSISTANT (PREVIOUS SUGGESTION)';
            return `[${label}]: ${item.text}`;
        }).join('\n');
    }

    /**
     * Get the last interviewer turn
     */
    getLastInterviewerTurn(): string | null {
        for (let i = this.contextItems.length - 1; i >= 0; i--) {
            if (this.contextItems[i].role === 'interviewer') {
                return this.contextItems[i].text;
            }
        }
        return null;
    }

    private mapSpeakerToRole(speaker: string): 'interviewer' | 'user' | 'assistant' {
        if (speaker === 'user') return 'user';
        if (speaker === 'assistant') return 'assistant';
        return 'interviewer'; // system audio = interviewer
    }

    private evictOldEntries(): void {
        const cutoff = Date.now() - (this.contextWindowDuration * 1000);
        this.contextItems = this.contextItems.filter(item => item.timestamp >= cutoff);

        // Safety limit
        if (this.contextItems.length > this.maxContextItems) {
            this.contextItems = this.contextItems.slice(-this.maxContextItems);
        }
    }

    // ============================================
    // Mode Executors (using mode-specific LLMs)
    // ============================================

    /**
     * MODE 1: Assist (Passive)
     * Low-priority observational insights
     */
    async runAssistMode(): Promise<string | null> {
        // Cancel if higher priority mode is active
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') {
            return null;
        }

        // Cancel previous assist if running
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
        }

        this.assistCancellationToken = new AbortController();
        this.setMode('assist');

        try {
            if (!this.assistLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.getFormattedContext(60); // Last 60 seconds
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const insight = await this.assistLLM.generate(context);

            // Check if cancelled
            if (this.assistCancellationToken?.signal.aborted) {
                return null;
            }

            if (insight) {
                this.emit('assist_update', insight);
            }
            this.setMode('idle');
            return insight;

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return null;
            }
            this.emit('error', error as Error, 'assist');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 2: What Should I Say (Primary)
     * Manual trigger - uses clean transcript pipeline for question inference
     * NEVER returns null - always provides a usable response
     */
    async runWhatShouldISay(question?: string, confidence: number = 0.8): Promise<string | null> {
        const now = Date.now();

        // Cooldown check
        if (now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }

        // Cancel assist mode if active
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('what_to_say');
        this.lastTriggerTime = now;

        try {
            // Use WhatToAnswerLLM for clean pipeline
            if (!this.whatToAnswerLLM) {
                // Fallback to AnswerLLM if not initialized
                if (!this.answerLLM) {
                    this.setMode('idle');
                    return "Could you repeat that? I want to make sure I address your question properly.";
                }
                const context = this.getFormattedContext(180);
                const answer = await this.answerLLM.generate(question || '', context);
                if (answer) {
                    this.addAssistantMessage(answer);
                    this.emit('suggested_answer', answer, question || 'inferred', confidence);
                }
                this.setMode('idle');
                return answer || "Could you repeat that? I want to make sure I address your question properly.";
            }

            // Prepare transcript using the new clean pipeline
            // Use 180 seconds window for broader context
            const contextItems = this.getContext(180);
            const transcriptTurns = contextItems.map(item => ({
                role: item.role,
                text: item.text,
                timestamp: item.timestamp
            }));

            // Clean, sparsify, format in one call
            const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);

            // Single-pass LLM call: question inference + answer generation
            const answer = await this.whatToAnswerLLM.generate(preparedTranscript);

            // Store in context (WhatToAnswerLLM never returns empty)
            this.addAssistantMessage(answer);
            this.emit('suggested_answer', answer, question || 'inferred from context', confidence);

            this.setMode('idle');
            return answer;

        } catch (error) {
            this.emit('error', error as Error, 'what_to_say');
            this.setMode('idle');
            // Never fail silently - return a usable fallback
            return "Could you repeat that? I want to make sure I address your question properly.";
        }
    }

    /**
     * MODE 3: Follow-Up (Refinement)
     * Modify the last assistant message
     */
    async runFollowUp(intent: string, userRequest?: string): Promise<string | null> {
        console.log(`[IntelligenceManager] runFollowUp called with intent: ${intent}`);
        if (!this.lastAssistantMessage) {
            console.warn('[IntelligenceManager] No lastAssistantMessage found for follow-up');
            return null;
        }

        this.setMode('follow_up');

        try {
            if (!this.followUpLLM) {
                console.error('[IntelligenceManager] FollowUpLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.getFormattedContext(60);
            const refinementRequest = userRequest || intent;
            const refined = await this.followUpLLM.generate(
                this.lastAssistantMessage,
                refinementRequest,
                context
            );

            if (refined) {
                // Store refined answer
                this.addAssistantMessage(refined);
                this.emit('refined_answer', refined, intent);
            }

            this.setMode('idle');
            return refined;

        } catch (error) {
            this.emit('error', error as Error, 'follow_up');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 4: Recap (Summary)
     * Neutral conversation summary
     */
    async runRecap(): Promise<string | null> {
        console.log('[IntelligenceManager] runRecap called');
        this.setMode('recap');

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceManager] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceManager] No context available for recap');
                this.setMode('idle');
                return null;
            }

            const summary = await this.recapLLM.generate(context);

            if (summary) {
                this.emit('recap', summary);
            }
            this.setMode('idle');
            return summary;

        } catch (error) {
            this.emit('error', error as Error, 'recap');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 6: Follow-Up Questions
     * Suggest strategic questions for the user to ask
     */
    async runFollowUpQuestions(): Promise<string | null> {
        console.log('[IntelligenceManager] runFollowUpQuestions called');
        this.setMode('follow_up_questions');

        try {
            if (!this.followUpQuestionsLLM) {
                console.error('[IntelligenceManager] FollowUpQuestionsLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceManager] No context available for follow-up questions');
                this.setMode('idle');
                return null;
            }

            const questions = await this.followUpQuestionsLLM.generate(context);

            if (questions) {
                this.emit('follow_up_questions_update', questions);
            }
            this.setMode('idle');
            return questions;

        } catch (error) {
            this.emit('error', error as Error, 'follow_up_questions');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    async runManualAnswer(question: string): Promise<string | null> {
        this.emit('manual_answer_started');
        this.setMode('manual');

        try {
            if (!this.answerLLM) {
                this.setMode('idle');
                return null;
            }

            // Use AnswerLLM with manual question
            const context = this.getFormattedContext(120);
            const answer = await this.answerLLM.generate(question, context);

            if (answer) {
                // Store in context
                this.addAssistantMessage(answer);
                this.emit('manual_answer_result', answer, question);
            }

            this.setMode('idle');
            return answer;

        } catch (error) {
            this.emit('error', error as Error, 'manual');
            this.setMode('idle');
            return null;
        }
    }

    // ============================================
    // Trigger Handlers (from NativeAudioClient events)
    // ============================================

    /**
     * Handle incoming transcript from native audio service
     */
    handleTranscript(segment: TranscriptSegment): void {
        this.addTranscript(segment);
    }

    /**
     * Handle suggestion trigger from native audio service
     * This is the primary auto-trigger path
     */
    async handleSuggestionTrigger(trigger: SuggestionTrigger): Promise<void> {
        // Confidence threshold
        if (trigger.confidence < 0.5) {
            return;
        }

        await this.runWhatShouldISay(trigger.lastQuestion, trigger.confidence);
    }

    // ============================================
    // State Management
    // ============================================

    private setMode(mode: IntelligenceMode): void {
        if (this.activeMode !== mode) {
            this.activeMode = mode;
            this.emit('mode_changed', mode);
        }
    }

    getActiveMode(): IntelligenceMode {
        return this.activeMode;
    }

    /**
     * Clear all context and reset state
     */
    reset(): void {
        this.contextItems = [];
        this.lastAssistantMessage = null;
        this.activeMode = 'idle';
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
    }

    /**
     * Reinitialize LLMs (e.g., after switching providers)
     */
    reinitializeLLMs(): void {
        this.initializeModeLLMs();
    }
}
