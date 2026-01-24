import React, { useState, useEffect } from 'react';
import { X, Check, Globe, RefreshCw } from 'lucide-react';

interface ModelConfig {
    provider: "gemini";
    model: string;
}

const AdvancedSettings: React.FC = () => {
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
    const [isLoading, setIsLoading] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const GEMINI_MODELS = [
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Fast & Multimodal)' },
        { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (High Intelligence)' },
        { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro (Legacy)' },
    ];

    // Load current config
    useEffect(() => {
        const loadConfig = async () => {
            try {
                // @ts-ignore
                const config = await window.electronAPI.getCurrentLlmConfig();
                if (config.provider === 'gemini') {
                    setSelectedModel(config.model);
                }
            } catch (e) {
                console.error(e);
            }
        };
        loadConfig();
    }, []);

    const handleSave = async () => {
        setSaveStatus('saving');
        try {
            // @ts-ignore
            const result = await window.electronAPI.switchToGemini(geminiApiKey || undefined, selectedModel);
            if (result.success) {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);

                // Sync with main app setting if we swiched to a Pro/Flash model
                if (selectedModel.includes('pro')) {
                    // @ts-ignore
                    window.electronAPI.invoke('set-model-preference', 'pro');
                } else {
                    // @ts-ignore
                    window.electronAPI.invoke('set-model-preference', 'flash');
                }

            } else {
                setSaveStatus('error');
                setTimeout(() => setSaveStatus('idle'), 3000);
            }
        } catch (e) {
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    return (
        <div className="w-full h-full bg-slate-900 overflow-hidden flex flex-col text-slate-200 select-none border border-slate-700/50 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5 drag font-medium text-xs">
                <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-blue-400" />
                    <span>Advanced AI Settings</span>
                </div>
                <button
                    // @ts-ignore
                    onClick={() => window.electronAPI.closeAdvancedSettings()}
                    className="p-1 hover:bg-white/10 rounded-md transition-colors no-drag"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar">

                {/* API Key Section */}
                <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Gemini API Key</label>
                    <input
                        type="password"
                        placeholder="Enter API Key (Hidden) •••••••••••"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all font-mono"
                    />
                    <p className="text-[10px] text-slate-500 leading-tight">
                        Leave blank to keep existing key. Keys are stored securely in memory.
                    </p>
                </div>

                {/* Model Selection */}
                <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Model Selection</label>
                    <div className="bg-slate-800/50 border border-white/10 rounded-lg overflow-hidden">
                        {GEMINI_MODELS.map((model) => (
                            <button
                                key={model.id}
                                onClick={() => setSelectedModel(model.id)}
                                className={`w-full text-left px-3 py-2.5 text-xs border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors flex items-center justify-between ${selectedModel === model.id ? 'bg-blue-500/10' : ''}`}
                            >
                                <span className={selectedModel === model.id ? 'text-blue-400 font-medium' : 'text-slate-300'}>
                                    {model.name}
                                </span>
                                {selectedModel === model.id && <Check className="w-3.5 h-3.5 text-blue-400" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Connection Test / Status */}
                <div className="pt-2">
                    <button
                        onClick={handleSave}
                        disabled={saveStatus === 'saving'}
                        className={`w-full py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${saveStatus === 'saved'
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                            : saveStatus === 'error'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                            }`}
                    >
                        {saveStatus === 'saving' && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {saveStatus === 'saved' ? 'Settings Saved' : saveStatus === 'error' ? 'Save Failed' : 'Save Configuration'}
                    </button>
                </div>

            </div>
        </div>
    );
};

export default AdvancedSettings;
