import React, { useState, useEffect } from 'react';
import { Ghost, MessageSquare, Link, Camera, X, Zap } from 'lucide-react';

const SettingsPopup = () => {
    const [isUndetectable, setIsUndetectable] = useState(() => localStorage.getItem('natively_undetectable') === 'true');
    const [useGeminiPro, setUseGeminiPro] = useState(() => {
        return localStorage.getItem('natively_model_preference') === 'pro';
    });

    const isFirstRender = React.useRef(true);
    const isFirstUndetectableRender = React.useRef(true);

    useEffect(() => {
        // Skip initial render
        if (isFirstUndetectableRender.current) {
            isFirstUndetectableRender.current = false;
            return;
        }

        localStorage.setItem('natively_undetectable', String(isUndetectable));
        if (window.electronAPI && window.electronAPI.setUndetectable) {
            window.electronAPI.setUndetectable(isUndetectable);
        }
    }, [isUndetectable]);

    useEffect(() => {
        // Skip initial render to avoid unnecessary IPC calls
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        // Apply model preference
        const modelType = useGeminiPro ? 'pro' : 'flash';
        localStorage.setItem('natively_model_preference', modelType);
        try {
            // @ts-ignore - electronAPI not typed in this file yet
            window.electronAPI?.invoke('set-model-preference', modelType);
        } catch (e) {
            console.error(e);
        }
    }, [useGeminiPro]);

    return (
        <div className="w-full h-full bg-transparent p-4 flex flex-col">
            <div className="w-full h-auto bg-[#2B2C2F]/90 backdrop-blur-xl border border-white/15 rounded-xl overflow-hidden shadow-[0_6px_30px_rgba(0,0,0,0.35)] p-1.5 flex flex-col">


                {/* Undetectability */}
                <div className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 rounded-lg transition-colors group">
                    <div className="flex items-center gap-2.5">
                        <CustomGhost
                            className="w-4 h-4 text-slate-400 group-hover:text-slate-200"
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? "black" : "white"}
                        />
                        <span className="text-[13px] text-slate-300 group-hover:text-white font-medium">{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => setIsUndetectable(!isUndetectable)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${isUndetectable ? 'bg-white' : 'bg-slate-700'}`}
                    >
                        <div className={`w-4 h-4 rounded-full bg-black shadow-sm transition-transform ${isUndetectable ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Gemini 3 Pro Toggle */}
                <div className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 rounded-lg transition-colors group">
                    <div className="flex items-center gap-2.5">
                        <Zap
                            className="w-4 h-4 text-yellow-500 group-hover:text-yellow-400"
                            fill={useGeminiPro ? "currentColor" : "none"}
                        />
                        <span className="text-[13px] text-slate-300 group-hover:text-white font-medium">Gemini 3 Pro</span>
                    </div>
                    <button
                        onClick={() => setUseGeminiPro(!useGeminiPro)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${useGeminiPro ? 'bg-yellow-500' : 'bg-slate-700'}`}
                    >
                        <div className={`w-4 h-4 rounded-full bg-black shadow-sm transition-transform ${useGeminiPro ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                </div>

                <div className="h-px bg-white/5 my-1" />

                {/* Show/Hide Cluely */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors group">
                    <div className="flex items-center gap-2.5">
                        <MessageSquare className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                        <span className="text-[12px] text-slate-400 group-hover:text-slate-200">Show/Hide Natively</span>
                    </div>
                    <div className="flex gap-1">
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-mono">⌘</div>
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-mono">\</div>
                    </div>
                </div>



                {/* Screenshot */}
                <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors group">
                    <div className="flex items-center gap-2.5">
                        <Camera className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                        <span className="text-[12px] text-slate-400 group-hover:text-slate-200">Screenshot</span>
                    </div>
                    <div className="flex gap-1">
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-mono">⌘</div>
                        <div className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[10px] text-slate-500 font-mono">H</div>
                    </div>
                </div>


            </div>
        </div>
    );
};

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: { className?: string, fill?: string, stroke?: string, eyeColor?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);

export default SettingsPopup;
