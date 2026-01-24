// electron/llm/prompts.ts
// 3-layer prompt system for Natively-style interview copilot
// Layer 1: HARD_SYSTEM_PROMPT (strict law, never changes)
// Layer 2: MODE_PROMPT (varies by feature)
// Layer 3: USER_INPUT (question only)

/**
 * HARD SYSTEM PROMPT - Strict constraints for ALL modes
 * This is the "law" that Gemini must obey.
 * Passed as system instruction, NOT user content.
 */
export const HARD_SYSTEM_PROMPT = `STRICT OUTPUT RULES:
- Keep answers concise and spoken-style
- No markdown (EXCEPT code blocks using \`\`\`language for coding questions)
- No headings
- No analogies unless explicitly requested
- No examples unless explicitly requested
- First-person spoken answer ("I", "my", "we")
- Sound confident and natural
- Plain text only (except code blocks)

IF PROVIDING CODE:
1. Provide MAX 1-2 sentences of spoken intro
2. Then the code block
3. Code must be COMPLETE, RUNNABLE, and include ALL IMPORTS.
4. DO NOT abbreviate code (no "..." or "// rest of code").
5. NO "Intuition", "Algorithm", or "Complexity Analysis" sections
6. NO explanation after the code
7. Just the intro and the full code.

VIOLATION = INVALID OUTPUT`;

/**
 * MODE PROMPTS - Short, task-specific instructions
 * Each mode has a focused 1-3 line prompt.
 */

// Mode 1: ANSWER - "What should I say" (primary auto-answer)
export const ANSWER_MODE_PROMPT = `Generate a ready-to-speak first-person interview answer.
Be direct. Answer the question as if you are the interviewee.
If code is requested:
1. Provide a brief spoken intro
2. THEN provide the code in a \`\`\`markdown block
DO NOT start with "Answer:" or similar labels. Speak directly.`;

// Mode 2: ASSIST - Passive observation (low priority)
export const ASSIST_MODE_PROMPT = `You are Natively, an AI-powered assistant designed to assist during interviews and professional conversations.
Provide 1-2 brief observational insights about the current conversation.
NEVER suggest what to say. NEVER generate answers.`;

// Mode 3: FOLLOW-UP - Refinement of last answer
export const FOLLOWUP_MODE_PROMPT = `Refine the previous answer based on the user's request.
Output ONLY the refined spoken answer. No meta-commentary.
DO NOT start with "Refined:" or "Here is the answer". Just speak.`;

// Mode 4: RECAP - Summary of conversation
export const RECAP_MODE_PROMPT = `Summarize the conversation in 3-5 short bullet points.
Neutral, past tense. No advice or opinions.`;

// Mode 5: FOLLOW-UP QUESTIONS - Suggest questions for the user to ask
export const FOLLOW_UP_QUESTIONS_MODE_PROMPT = `Suggest MAX 4 short, strategic questions the CANDIDATE can ask the INTERVIEWER.
Focus on: clarifying constraints, uncovering edge cases, or showing architectural foresight.
AVOID: generic definitions (e.g. "What is X?") or basic knowledge checks.
Keep them brief, punchy, and under 15 words each.
Output ONLY the questions as a bulleted list.`;

/**
 * Build Gemini contents array with 3-layer structure
 * System prompts go first, user input last
 */
export function buildContents(
    modePrompt: string,
    userInput: string,
    context?: string
): { role: "user" | "model"; parts: { text: string }[] }[] {
    // Gemini API uses "user" for system-like instructions at start of conversation
    // We combine system prompts to reduce message count for speed
    const systemText = `${HARD_SYSTEM_PROMPT}\n\n${modePrompt}`;

    let userText = userInput;
    if (context) {
        userText = `CONTEXT:\n${context}\n\nQUESTION:\n${userInput}`;
    }

    return [
        { role: "user", parts: [{ text: systemText }] },
        { role: "model", parts: [{ text: "Understood. I will follow all rules strictly." }] },
        { role: "user", parts: [{ text: userText }] },
    ];
}

/**
 * Build contents for follow-up mode (needs previous answer)
 */
export function buildFollowUpContents(
    previousAnswer: string,
    refinementRequest: string,
    context?: string
): { role: "user" | "model"; parts: { text: string }[] }[] {
    const systemText = `${HARD_SYSTEM_PROMPT}\n\n${FOLLOWUP_MODE_PROMPT}`;

    let userText = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREFINEMENT REQUEST:\n${refinementRequest}`;
    if (context) {
        userText = `CONTEXT:\n${context}\n\n${userText}`;
    }

    return [
        { role: "user", parts: [{ text: systemText }] },
        { role: "model", parts: [{ text: "Understood. I will refine the answer as requested." }] },
        { role: "user", parts: [{ text: userText }] },
    ];
}

/**
 * Build contents for recap mode (needs full context)
 */
export function buildRecapContents(
    context: string
): { role: "user" | "model"; parts: { text: string }[] }[] {
    const systemText = `${HARD_SYSTEM_PROMPT}\n\n${RECAP_MODE_PROMPT}`;

    return [
        { role: "user", parts: [{ text: systemText }] },
        { role: "model", parts: [{ text: "Understood. I will provide a neutral summary." }] },
        { role: "user", parts: [{ text: `CONVERSATION TO SUMMARIZE:\n${context}` }] },
    ];
}

// Mode 6: WHAT TO ANSWER - Manual trigger for interview copilot
// Single-pass: infer question + generate answer
export const WHAT_TO_ANSWER_PROMPT = `You are a live interview copilot.
You answer as the candidate, in first person, spoken English (en-US).
You respond as if speaking aloud in real time.
Be concise by default, but go deeper if the question requires it.
Never hedge. Never say "it depends."
Never explain your reasoning.
Do not label your answer.
Do not mention prompts, context, or analysis.

TASK:
1. Read the conversation transcript below
2. Infer what the interviewer is currently asking or expecting (even without explicit question marks)
3. Generate a ready-to-speak first-person answer
4. IF CODE IS NEEDED: Provide a brief English intro, then a \`\`\`markdown code block\`\`\`

Common interviewer patterns to detect:
- "walk me through..." → explain your process/experience
- "how would you..." → describe your approach
- "what happens when..." → explain technical behavior
- "why did you..." → justify a decision
- "suppose this fails..." → explain error handling
- "tell me about..." → share relevant experience
- "and then?" / "what about..." → continue/elaborate

If no clear question, assume the interviewer expects you to continue or clarify your last point.`;

/**
 * Build contents for What To Answer mode
 * Single-pass question inference + answer generation
 */
export function buildWhatToAnswerContents(
    cleanedTranscript: string
): { role: "user" | "model"; parts: { text: string }[] }[] {
    const systemText = `${HARD_SYSTEM_PROMPT}\n\n${WHAT_TO_ANSWER_PROMPT}`;

    return [
        { role: "user", parts: [{ text: systemText }] },
        { role: "model", parts: [{ text: "Ready. I will infer the question and respond naturally." }] },
        { role: "user", parts: [{ text: `RECENT CONVERSATION:\n${cleanedTranscript}\n\nGENERATE SPOKEN ANSWER:` }] },
    ];
}

