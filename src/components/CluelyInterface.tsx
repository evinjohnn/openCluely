import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
    Sparkles,
    Pencil,
    MessageSquare,
    RefreshCw,
    Settings,
    ArrowUp,
    ArrowRight,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Command,
    CornerDownLeft,
    Mic,
    MicOff,
    Image,
    Camera,
    X,
    LogOut,
    Zap,
    Edit3,
    SlidersHorizontal,
    Ghost,
    Link,
    Code
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ModelSelector from './ui/ModelSelector';
import TopPill from './ui/TopPill';

interface Message {
    id: string;
    role: 'user' | 'system' | 'interviewer';
    text: string;
    isStreaming?: boolean;
    hasScreenshot?: boolean;
    screenshotPreview?: string;
    isCode?: boolean;
    intent?: string;
}

const NativelyInterface = () => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [conversationContext, setConversationContext] = useState<string>('');
    const [isManualRecording, setIsManualRecording] = useState(false);
    const isRecordingRef = useRef(false);  // Ref to track recording state (avoids stale closure)
    const [manualTranscript, setManualTranscript] = useState('');
    const [voiceInput, setVoiceInput] = useState('');  // Accumulated user voice input
    const voiceInputRef = useRef<string>('');  // Ref for capturing in async handlers
    const textInputRef = useRef<HTMLInputElement>(null); // Ref for input focus

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    // const settingsButtonRef = useRef<HTMLButtonElement>(null);

    // Latent Context State (Screenshot attached but not sent)
    const [attachedContext, setAttachedContext] = useState<{ path: string, preview: string } | null>(null);

    // Settings State with Persistence
    const [isUndetectable, setIsUndetectable] = useState(true);
    const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
        const stored = localStorage.getItem('natively_hideChatHidesWidget');
        return stored ? stored === 'true' : true;
    });

    // Persist Settings
    useEffect(() => {
        localStorage.setItem('natively_undetectable', String(isUndetectable));
        localStorage.setItem('natively_hideChatHidesWidget', String(hideChatHidesWidget));
    }, [isUndetectable, hideChatHidesWidget]);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Use getBoundingClientRect to get the exact rendered size including padding
                const rect = entry.target.getBoundingClientRect();

                // Send exact dimensions to Electron
                // Removed buffer to ensure tight fit
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    // Auto-scroll
    useEffect(() => {
        if (isExpanded) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isExpanded, isProcessing]);

    // Build conversation context from messages
    useEffect(() => {
        const context = messages
            .filter(m => m.role !== 'user' || !m.hasScreenshot)
            .map(m => `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .slice(-20)
            .join('\n');
        setConversationContext(context);
    }, [messages]);

    // Listen for settings window visibility changes
    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
            setIsSettingsOpen(isVisible);
        });
        return () => unsubscribe();
    }, []);

    // Sync Window Visibility with Expanded State
    useEffect(() => {
        if (isExpanded) {
            window.electronAPI.showWindow();
        } else {
            // Slight delay to allow animation to clean up if needed, though immediate is safer for click-through
            // Using setTimeout to ensure the render cycle completes first
            setTimeout(() => window.electronAPI.hideWindow(), 100);
        }
    }, [isExpanded]);

    // Keyboard shortcut to toggle expanded state (via Main Process)
    useEffect(() => {
        if (!window.electronAPI?.onToggleExpand) return;
        const unsubscribe = window.electronAPI.onToggleExpand(() => {
            setIsExpanded(prev => !prev);
        });
        return () => unsubscribe();
    }, []);

    // Connect to Native Audio Backend
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Connection Status
        window.electronAPI.getNativeAudioStatus().then((status) => {
            setIsConnected(status.connected);
            setIsConnected(status.connected);
        }).catch(() => setIsConnected(false));

        cleanups.push(window.electronAPI.onNativeAudioConnected(() => {
            setIsConnected(true);
            setIsConnected(true);
        }));
        cleanups.push(window.electronAPI.onNativeAudioDisconnected(() => {
            setIsConnected(false);
            setIsConnected(false);
        }));

        // Real-time Transcripts
        cleanups.push(window.electronAPI.onNativeAudioTranscript((transcript) => {
            // When Answer button is active, capture USER transcripts for voice input
            // Use ref to avoid stale closure issue
            if (isRecordingRef.current && transcript.speaker === 'user') {
                if (transcript.final) {
                    // Accumulate final transcripts
                    setVoiceInput(prev => {
                        const updated = prev + (prev ? ' ' : '') + transcript.text;
                        voiceInputRef.current = updated;
                        return updated;
                    });
                    setManualTranscript('');  // Clear partial preview
                } else {
                    // Show live partial transcript
                    setManualTranscript(transcript.text);
                }
                return;  // Don't add to messages while recording
            }

            // Ignore user mic transcripts when not recording
            // Only interviewer (system audio) transcripts should appear in chat
            if (transcript.speaker === 'user') {
                return;  // Skip user mic input - only relevant when Answer button is active
            }

            // Only show interviewer (system audio) transcripts in chat
            if (transcript.speaker !== 'interviewer') {
                return;  // Safety check for any other speaker types
            }

            // Normal transcript handling for interviewer (system audio)
            if (!transcript.final) {
                setManualTranscript(transcript.text);
            } else {
                setManualTranscript('');
            }

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'interviewer' && lastMsg.isStreaming) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: transcript.text,
                        isStreaming: !transcript.final
                    };
                    return updated;
                }

                if (transcript.final && !isExpanded) setIsExpanded(true);

                return [...prev, {
                    id: Date.now().toString(),
                    role: 'interviewer',
                    text: transcript.text,
                    isStreaming: !transcript.final
                }];
            });
        }));

        // AI Suggestions from native audio (legacy)
        cleanups.push(window.electronAPI.onSuggestionProcessingStart(() => {
            setIsProcessing(true);
            setIsExpanded(true);
        }));

        cleanups.push(window.electronAPI.onSuggestionGenerated((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.suggestion
            }]);
        }));

        cleanups.push(window.electronAPI.onSuggestionError((err) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err.error}`
            }]);
        }));



        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.answer,  // Plain text, no markdown - ready to speak
                intent: 'what_to_answer'
            }]);
        }));

        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
            setIsProcessing(false);

            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.answer,
                intent: data.intent
            }]);
        }));

        cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.summary,
                intent: 'recap'
            }]);
        }));

        cleanups.push(window.electronAPI.onIntelligenceManualResult((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `🎯 **Answer:**\n\n${data.answer}`
            }]);
        }));

        cleanups.push(window.electronAPI.onIntelligenceError((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `❌ Error (${data.mode}): ${data.error}`
            }]);
        }));


        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.questions, // Raw questions, no prefix
                intent: 'follow_up_questions' // Custom intent for styling
            }]);
        }));

        // Screenshot taken - auto-analyze
        cleanups.push(window.electronAPI.onScreenshotTaken(async (data) => {
            setIsExpanded(true);
            setIsProcessing(true);

            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'Analyzing screenshot...',
                hasScreenshot: true,
                screenshotPreview: data.preview
            }]);

            // Auto-focus input for immediate typing (Robust Retry)
            // We retry a few times to ensure window focus has settled
            [100, 300, 600].forEach(delay => {
                setTimeout(() => {
                    textInputRef.current?.focus();
                }, delay);
            });

            try {
                const result = await window.electronAPI.invoke('analyze-image-file', data.path);
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: result.text
                }]);
            } catch (err) {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: `Error analyzing screenshot: ${err}`
                }]);
            } finally {
                setIsProcessing(false);
            }
        }));

        // Selective Screenshot (Latent Context)
        if (window.electronAPI.onScreenshotAttached) {
            cleanups.push(window.electronAPI.onScreenshotAttached((data) => {
                setIsExpanded(true);
                setAttachedContext(data);
                // toast/notification could go here
            }));
        }

        return () => cleanups.forEach(fn => fn());
    }, [isExpanded]);

    // Quick Actions - Updated to use new Intelligence APIs


    const handleWhatToSay = async () => {
        setIsExpanded(true);
        setIsProcessing(true);

        try {
            await window.electronAPI.generateWhatToSay();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFollowUp = async (intent: string = 'rephrase') => {
        setIsExpanded(true);
        setIsProcessing(true);

        try {
            await window.electronAPI.generateFollowUp(intent);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRecap = async () => {
        setIsExpanded(true);
        setIsProcessing(true);

        try {
            await window.electronAPI.generateRecap();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFollowUpQuestions = async () => {
        setIsExpanded(true);
        setIsProcessing(true);

        try {
            await window.electronAPI.generateFollowUpQuestions();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    // MODE 5: Manual Answer - Toggle recording for voice-to-answer
    const handleAnswerNow = async () => {
        if (isManualRecording) {
            // Stop recording - send accumulated voice input to Gemini
            isRecordingRef.current = false;  // Update ref immediately
            setIsManualRecording(false);
            setManualTranscript('');  // Clear live preview

            const currentAttachment = attachedContext;
            setAttachedContext(null); // Clear context immediately on send

            const question = voiceInputRef.current.trim();
            setVoiceInput('');
            voiceInputRef.current = '';

            if (!question && !currentAttachment) {
                // No voice input and no image
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: '⚠️ No speech detected. Try speaking closer to your microphone.'
                }]);
                return;
            }

            // Show user's spoken question
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: question,
                hasScreenshot: !!currentAttachment,
                screenshotPreview: currentAttachment?.preview
            }]);

            setIsProcessing(true);

            try {
                let prompt = '';

                if (currentAttachment) {
                    // Image + Voice Context
                    prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
                } else {
                    // Voice Only (Smart Extract)
                    prompt = `You are a real-time interview assistant. The user just repeated or paraphrased a question from their interviewer.

User said: "${question}"

Instructions:
1. Extract the core question being asked
2. Provide a clear, concise, and professional answer that the user can say out loud
3. Keep the answer conversational but informative (2-4 sentences ideal)
4. Do NOT include phrases like "The question is..." - just give the answer directly
5. Format for speaking out loud, not for reading

Provide only the answer, nothing else.`;
                }

                const response = await window.electronAPI.invoke('gemini-chat', prompt, currentAttachment?.path);
                const isCode = response.includes('```') || response.includes('def ') || response.includes('function ');

                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: response,
                    isCode
                }]);
            } catch (err) {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: `❌ Error: ${err}`
                }]);
            } finally {
                setIsProcessing(false);
            }
        } else {
            // Start recording - reset voice input state
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            isRecordingRef.current = true;  // Update ref immediately
            setIsManualRecording(true);
            setIsExpanded(true);

            // Ensure native audio is connected
            try {
                await window.electronAPI.invoke('native-audio-connect');
            } catch (err) {
                // Already connected, that's fine
            }
        }
    };

    const handleManualSubmit = async () => {
        if (!inputValue.trim() && !attachedContext) return;

        const userText = inputValue;
        const currentAttachment = attachedContext;

        // Clear inputs immediately
        setInputValue('');
        setAttachedContext(null);

        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            text: userText || (currentAttachment ? 'Analyze this screenshot' : ''),
            hasScreenshot: !!currentAttachment,
            screenshotPreview: currentAttachment?.preview
        }]);

        setIsExpanded(true);
        setIsProcessing(true);

        try {
            // Pass imagePath if attached, AND conversation context
            const response = await window.electronAPI.invoke(
                'gemini-chat',
                userText || 'Analyze this screenshot',
                currentAttachment?.path,
                conversationContext // Pass context so "answer this" works
            );

            const isCode = response.includes('```') || response.includes('def ') || response.includes('function ');

            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: response,
                isCode
            }]);
        } catch (err) {
            // Silent error
        } finally {
            setIsProcessing(false);
        }
    };

    const clearChat = () => {
        setMessages([]);
    };



    const renderMessageText = (msg: Message) => {
        // Code-containing messages get special styling
        if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
            const parts = msg.text.split(/(```[\s\S]*?```)/g);
            return (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 my-1">
                    <div className="flex items-center gap-2 mb-2 text-purple-300 font-semibold text-xs uppercase tracking-wide">
                        <Code className="w-3.5 h-3.5" />
                        <span>Code Solution</span>
                    </div>
                    <div className="space-y-2 text-slate-200 text-[13px] leading-relaxed">
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                                if (match) {
                                    const lang = match[1] || 'python';
                                    const code = match[2].trim();
                                    return (
                                        <div key={i} className="my-3 rounded-lg overflow-hidden border border-white/10 shadow-sm bg-[#0f172a]">
                                            {/* IDE-style Header */}
                                            <div className="bg-[#1e293b] px-3 py-1.5 flex items-center justify-between border-b border-white/5">
                                                <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-400 font-mono">
                                                    <div className="w-2 h-2 rounded-full bg-purple-500/80" />
                                                    {lang || 'CODE'}
                                                </div>
                                                <div className="flex gap-1.5">
                                                    <div className="w-2 h-2 rounded-full bg-white/10" />
                                                    <div className="w-2 h-2 rounded-full bg-white/10" />
                                                </div>
                                            </div>
                                            <SyntaxHighlighter
                                                language={lang}
                                                style={dracula}
                                                customStyle={{
                                                    margin: 0,
                                                    borderRadius: 0,
                                                    fontSize: '12px',
                                                    background: 'transparent',
                                                    padding: '12px',
                                                    fontFamily: 'JetBrains Mono, Menlo, monospace'
                                                }}
                                                wrapLongLines={true}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: '2em', paddingRight: '1em', color: '#475569', textAlign: 'right' }}
                                            >
                                                {code}
                                            </SyntaxHighlighter>
                                        </div>
                                    );
                                }
                            }
                            return <div key={i} className="whitespace-pre-wrap">{part}</div>;
                        })}
                    </div>
                </div>
            );
        }

        // Custom Styled Labels
        if (msg.intent === 'shorten') {
            return (
                <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3 my-1">
                    <div className="flex items-center gap-2 mb-2 text-cyan-300 font-semibold text-xs uppercase tracking-wide">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Shortened</span>
                    </div>
                    <div className="text-slate-200 text-[13px] leading-relaxed whitespace-pre-wrap">
                        {msg.text}
                    </div>
                </div>
            );
        }

        if (msg.intent === 'recap') {
            return (
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 my-1">
                    <div className="flex items-center gap-2 mb-2 text-indigo-300 font-semibold text-xs uppercase tracking-wide">
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Recap</span>
                    </div>
                    <div className="text-slate-200 text-[13px] leading-relaxed whitespace-pre-wrap">
                        {msg.text}
                    </div>
                </div>
            );
        }

        if (msg.intent === 'follow_up_questions') {
            return (
                <div className="bg-[#FFD60A]/10 border border-[#FFD60A]/20 rounded-lg p-3 my-1">
                    <div className="flex items-center gap-2 mb-2 text-[#FFD60A] font-semibold text-xs uppercase tracking-wide">
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Follow-Up Questions</span>
                    </div>
                    <div className="text-slate-200 text-[13px] leading-relaxed whitespace-pre-wrap">
                        {msg.text}
                    </div>
                </div>
            );
        }

        if (msg.intent === 'what_to_answer') {
            // Split text by code blocks (Handle unclosed blocks at EOF)
            const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

            return (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 my-1">
                    <div className="flex items-center gap-2 mb-2 text-emerald-400 font-semibold text-xs uppercase tracking-wide">
                        <span>Say this</span>
                    </div>
                    <div className="text-slate-100 text-[14px] leading-relaxed">
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                // Robust matching: handles unclosed blocks for streaming (```...$)
                                const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                                // Fallback logic: if it starts with ticks, treat as code (even if unclosed)
                                if (match || part.startsWith('```')) {
                                    const lang = (match && match[1]) ? match[1] : 'python';
                                    let code = '';

                                    if (match && match[2]) {
                                        code = match[2].trim();
                                    } else {
                                        // Manual strip if regex failed
                                        code = part.replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
                                    }

                                    return (
                                        <div key={i} className="my-3 rounded-lg overflow-hidden border border-white/10 shadow-sm bg-[#0f172a]">
                                            {/* IDE-style Header */}
                                            <div className="bg-[#1e293b] px-3 py-1.5 flex items-center justify-between border-b border-white/5">
                                                <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-400 font-mono">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500/80" />
                                                    {lang || 'CODE'}
                                                </div>
                                                <div className="flex gap-1.5">
                                                    <div className="w-2 h-2 rounded-full bg-white/10" />
                                                    <div className="w-2 h-2 rounded-full bg-white/10" />
                                                </div>
                                            </div>

                                            <SyntaxHighlighter
                                                language={lang}
                                                style={dracula}
                                                customStyle={{
                                                    margin: 0,
                                                    borderRadius: 0,
                                                    fontSize: '12px',
                                                    background: 'transparent',
                                                    padding: '12px',
                                                    fontFamily: 'JetBrains Mono, Menlo, monospace'
                                                }}
                                                wrapLongLines={true}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: '2em', paddingRight: '1em', color: '#475569', textAlign: 'right' }}
                                            >
                                                {code}
                                            </SyntaxHighlighter>
                                        </div>
                                    );
                                }
                            }
                            // Regular text
                            return <div key={i} className="whitespace-pre-wrap">{part}</div>;
                        })}
                    </div>
                </div>
            );
        }

        return msg.text;
    };

    return (
        <div ref={contentRef} className="flex flex-col items-center w-fit mx-auto min-h-0 bg-transparent p-0 rounded-[24px] font-sans text-slate-200 gap-2">

            {isExpanded && (
                <>
                    <TopPill
                        expanded={isExpanded}
                        onToggle={() => setIsExpanded(!isExpanded)}
                        onQuit={() => window.electronAPI.quitApp()}
                    />
                    <div className="
                    relative w-[600px] max-w-full
                    bg-[#1E1E1E]/95
                    backdrop-blur-2xl
                    border border-white/10
                    shadow-2xl shadow-black/40
                    rounded-[24px] 
                    overflow-hidden 
                    flex flex-col
                    animate-in fade-in slide-in-from-bottom-4 duration-500 ease-sculpted
                ">



                        {/* Chat History - Only show if there are messages */}
                        {messages.length > 0 && (
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[clamp(300px,35vh,450px)]" style={{ scrollbarWidth: 'none' }}>
                                {messages.map((msg) => (
                                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                                        <div className={`
                      ${msg.role === 'user' ? 'max-w-[72.25%] px-[13.6px] py-[10.2px]' : 'max-w-[85%] px-4 py-3'} text-[14px] leading-relaxed relative group whitespace-pre-wrap
                      ${msg.role === 'user'
                                                ? 'bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-blue-100 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                                                : ''
                                            }
                      ${msg.role === 'system'
                                                ? 'text-slate-200 font-normal'
                                                : ''
                                            }
                      ${msg.role === 'interviewer'
                                                ? 'text-white/40 italic pl-0 text-[13px]'
                                                : ''
                                            }
                    `}>
                                            {msg.role === 'interviewer' && (
                                                <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-600 font-medium uppercase tracking-wider">
                                                    Interviewer
                                                    {msg.isStreaming && <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                                                </div>
                                            )}
                                            {msg.role === 'user' && msg.hasScreenshot && (
                                                <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b border-white/10 pb-1">
                                                    <Image className="w-2.5 h-2.5" />
                                                    <span>Screenshot attached</span>
                                                </div>
                                            )}
                                            {renderMessageText(msg)}
                                        </div>
                                    </div>
                                ))}

                                {/* Active Recording State with Live Transcription */}
                                {isManualRecording && (
                                    <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {/* Live transcription preview */}
                                        {(manualTranscript || voiceInput) && (
                                            <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                                                <span className="text-[13px] text-emerald-300">
                                                    {voiceInput}{voiceInput && manualTranscript ? ' ' : ''}{manualTranscript}
                                                </span>
                                            </div>
                                        )}
                                        <div className="px-3 py-2 flex gap-1.5 items-center">
                                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
                                        </div>
                                    </div>
                                )}

                                {isProcessing && (
                                    <div className="flex justify-start">
                                        <div className="px-3 py-2 flex gap-1.5">
                                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        )}

                        {/* Quick Actions - Minimal & Clean */}
                        <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 py-3 border-t border-white/[0.06] overflow-x-hidden">
                            <button onClick={handleWhatToSay} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-slate-400 bg-white/5 border border-white/0 hover:text-slate-200 hover:bg-white/10 hover:border-white/5 transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0">
                                <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                            </button>
                            <button onClick={() => handleFollowUp('shorten')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-slate-400 bg-white/5 border border-white/0 hover:text-slate-200 hover:bg-white/10 hover:border-white/5 transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0">
                                <MessageSquare className="w-3 h-3 opacity-70" /> Shorten
                            </button>
                            <button onClick={handleRecap} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-slate-400 bg-white/5 border border-white/0 hover:text-slate-200 hover:bg-white/10 hover:border-white/5 transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0">
                                <RefreshCw className="w-3 h-3 opacity-70" /> Recap
                            </button>
                            <button onClick={handleFollowUpQuestions} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-slate-400 bg-white/5 border border-white/0 hover:text-slate-200 hover:bg-white/10 hover:border-white/5 transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0">
                                <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question
                            </button>
                            <button
                                onClick={handleAnswerNow}
                                className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-95 duration-200 interaction-base interaction-press min-w-[74px] whitespace-nowrap shrink-0 ${isManualRecording
                                    ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                                    : 'bg-white/5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10'
                                    }`}
                            >
                                {isManualRecording ? (
                                    <>
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                        Stop
                                    </>
                                ) : (
                                    <><Zap className="w-3 h-3 opacity-70" /> Answer</>
                                )}
                            </button>
                        </div>

                        {/* Input Area */}
                        <div className="p-3 pt-0">
                            {/* Latent Context Preview (Attached Screenshot) */}
                            {attachedContext && (
                                <div className="mb-2 flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-2 animate-in fade-in slide-in-from-bottom-1">
                                    <div className="flex items-center gap-3">
                                        <div className="relative group">
                                            <img
                                                src={attachedContext.preview}
                                                alt="Context"
                                                className="h-10 w-auto rounded border border-white/20"
                                            />
                                            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors rounded" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-medium text-white">Screenshot attached</span>
                                            <span className="text-[10px] text-slate-400">Ask a question or click Answer</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setAttachedContext(null)}
                                        className="p-1 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}

                            <div className="relative group">
                                <input
                                    ref={textInputRef}
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}

                                    className="
                                    w-full 
                                    bg-[#1E1E1E] 
                                    hover:bg-[#252525] 
                                    focus:bg-[#1E1E1E]
                                    border border-white/5 
                                    focus:border-white/10
                                    focus:ring-1 focus:ring-white/10
                                    rounded-xl 
                                    pl-3 pr-10 py-2.5 
                                    text-slate-200 
                                    focus:outline-none 
                                    transition-all duration-200 ease-sculpted
                                    text-[13px] leading-relaxed
                                    placeholder:text-slate-500
                                "
                                />

                                {/* Custom Rich Placeholder */}
                                {!inputValue && (
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] text-slate-400">
                                        <span>Ask anything on screen or conversation, or</span>
                                        <div className="flex items-center gap-1 opacity-80">
                                            <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] font-sans">⌘</kbd>
                                            <span className="text-[10px]">+</span>
                                            <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] font-sans">H</kbd>
                                        </div>
                                        <span>for screenshot</span>
                                    </div>
                                )}

                                {!inputValue && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                                        <span className="text-[10px]">↵</span>
                                    </div>
                                )}
                            </div>

                            {/* Bottom Row */}
                            <div className="flex items-center justify-between mt-3 px-0.5">
                                <div className="flex items-center gap-1.5">
                                    <button className="
                                    flex items-center gap-1.5 
                                    text-[#FFD60A] 
                                    bg-[#FFD60A]/10 
                                    hover:bg-[#FFD60A]/15
                                    px-2.5 py-1 
                                    rounded-md 
                                    text-[10px] font-semibold tracking-wide uppercase
                                    transition-colors
                                    interaction-base interaction-press
                                ">
                                        <Sparkles className="w-2.5 h-2.5" />
                                        Smart
                                    </button>

                                    <div className="w-px h-3 bg-white/10 mx-1" />

                                    {/* Settings Gear */}
                                    <div className="relative">
                                        <button
                                            onClick={(e) => {
                                                if (isSettingsOpen) {
                                                    // If open, just close it (toggle will handle logic but we can be explicit or just toggle)
                                                    // Actually toggle-settings-window handles hiding if visible, so logic is same.
                                                    window.electronAPI.invoke('toggle-settings-window');
                                                    return;
                                                }

                                                if (!contentRef.current) return;

                                                const contentRect = contentRef.current.getBoundingClientRect();
                                                const buttonRect = e.currentTarget.getBoundingClientRect();
                                                const POPUP_WIDTH = 270; // Matches SettingsWindowHelper actual width
                                                const GAP = 8; // Same gap as between TopPill and main body (gap-2 = 8px)

                                                // X: Left-aligned relative to the Settings Button
                                                const x = window.screenX + buttonRect.left;

                                                // Y: Below the main content + gap
                                                const y = window.screenY + contentRect.bottom + GAP;

                                                window.electronAPI.invoke('toggle-settings-window', { x, y });
                                            }}
                                            className={`
                                            w-7 h-7 flex items-center justify-center rounded-lg 
                                            interaction-base interaction-press
                                            ${isSettingsOpen ? 'text-white bg-white/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}
                                        `}
                                            title="Settings"
                                        >
                                            <SlidersHorizontal className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                </div>

                                <button
                                    onClick={handleManualSubmit}
                                    disabled={!inputValue.trim()}
                                    className={`
                                    w-7 h-7 rounded-full flex items-center justify-center 
                                    interaction-base interaction-press
                                    ${inputValue.trim()
                                            ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                                            : 'bg-white/5 text-white/10 cursor-not-allowed'
                                        }
                                `}
                                >
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default NativelyInterface;
